import { gameConfig as C, PRODUCT_IDS, WEEKS_PER_TURN } from '../config/gameConfig';
import { money } from './money';
import { demandNoise, diffOf, expectedDemand, getTurnEnv, normalizeDecisions, productById, shelfWeeks, zeroNoise, perProduct } from './model';
import type { CoreState, Lot, NoiseSet, ProductResult, SimOptions, TurnResult, WeekRow } from './types';

/** 計算中のロット（四半期の中で何個売れ・何個捨てたかを記録） */
interface WorkLot {
  qty0: number;
  value0: number;
  qty: number;
  weeksLeft: number;
  sold: number;
  wasted: number;
}

/**
 * 1ターン（3か月＝13週）の計算。state は変更しない純粋関数。
 *
 * 週ごとの流れ：
 *  1. 週のはじめに仕入れが入荷し、代金を現金で支払う
 *  2. その週の需要が来る。売れる在庫と販売能力（人員）の範囲で、古いロットから売る（先入れ先出し）
 *  3. 売上代金はその週に現金で受け取る
 *  4. 週の終わりに各ロットの「あと何週売れるか」を1減らし、0になった売れ残りは廃棄
 * 期首：借入・返済・設備代金・家賃を支払う。期末：人件費・水道光熱費・広告費・支払利息を支払う。
 * 期末に残ったロット（まだ売れる期間があるもの）だけが次期へ持ち越される。
 */
export function simulateTurn(state: CoreState, rawDecisions: unknown, opts: SimOptions = {}): TurnResult {
  const d = diffOf(state);
  const t = state.turn;
  const dec = normalizeDecisions(state, rawDecisions);
  if (opts.noFridge) dec.buyFridge = false;
  const env = getTurnEnv(state, t);
  const noise: NoiseSet = opts.noise === 'zero' ? zeroNoise() : (opts.noise && typeof opts.noise === 'object') ? opts.noise : demandNoise(state, t);

  const fridgeOwned = !opts.noFridge && (state.fridge.owned || dec.buyFridge);
  const capex = dec.buyFridge ? C.fridge.price : 0;
  const capacityPerWeek = dec.staff * C.staff.capacityPerWeek;

  // 期首：お金の出入り
  const cashBegin = state.cash;
  let cash = cashBegin + dec.borrow - dec.repay - capex - C.rent;
  let minCash = cash, minWhen = '期首（家賃・設備・返済の支払い後）';
  const track = (label: string) => { if (cash < minCash) { minCash = cash; minWhen = label; } };

  // 在庫ロットの準備（持ち越し分）
  // （冷蔵設備がない比較計算では、持ち越し分の残り週数も設備なしの上限に合わせる）
  const lots = perProduct<WorkLot[]>(id => state.inventory[id].map(l => ({ qty0: l.qty, value0: l.value, qty: l.qty, weeksLeft: Math.min(l.weeksLeft, shelfWeeks(id, fridgeOwned)), sold: 0, wasted: 0 })));
  const begin = perProduct(id => ({ qty: state.inventory[id].reduce((s, l) => s + l.qty, 0), value: state.inventory[id].reduce((s, l) => s + l.value, 0) }));
  const acc = perProduct(() => ({ demand: 0, sold: 0, stockout: 0, capacityLost: 0, waste: 0, purchaseQty: 0, purchaseCost: 0, revenue: 0, weeks: [] as WeekRow[] }));
  const expQ = perProduct(id => expectedDemand(env, id, dec.prices[id], dec.ad));
  let revenueTotal = 0, purchaseTotal = 0;

  for (let w = 0; w < WEEKS_PER_TURN; w++) {
    // 1) 入荷と支払い
    for (const id of PRODUCT_IDS) {
      const q = dec.orders[id];
      if (q > 0) {
        const cost = money(q * env.products[id].cost);
        lots[id].push({ qty0: q, value0: cost, qty: q, weeksLeft: shelfWeeks(id, fridgeOwned), sold: 0, wasted: 0 });
        acc[id].purchaseQty += q; acc[id].purchaseCost += cost; purchaseTotal += cost;
        cash -= cost;
      }
    }
    track(`${w + 1}週目（仕入れ代金の支払い後）`);

    // 2) 需要と販売
    const demand = perProduct(id => Math.max(0, Math.round(expQ[id] / WEEKS_PER_TURN * (1 + noise.quarter[id]) * (1 + noise.weeks[w][id]))));
    const stock = perProduct(id => lots[id].reduce((s, l) => s + l.qty, 0));
    const request = perProduct(id => Math.min(demand[id], stock[id]));
    const totalReq = PRODUCT_IDS.reduce((s, id) => s + request[id], 0);
    const ratio = totalReq > capacityPerWeek ? capacityPerWeek / totalReq : 1;
    for (const id of PRODUCT_IDS) {
      const sold = Math.floor(request[id] * ratio);
      // 古いロット（残り週数が少ない順）から売る
      let rest = sold;
      const order = lots[id].filter(l => l.qty > 0).sort((a, b) => a.weeksLeft - b.weeksLeft);
      for (const l of order) {
        if (rest <= 0) break;
        const k = Math.min(l.qty, rest);
        l.qty -= k; l.sold += k; rest -= k;
      }
      const rev = money(sold * dec.prices[id]);
      acc[id].demand += demand[id]; acc[id].sold += sold;
      acc[id].stockout += demand[id] - request[id];
      acc[id].capacityLost += request[id] - sold;
      acc[id].revenue += rev; revenueTotal += rev;
      cash += rev;
      // 4) 週末：鮮度の期限
      let waste = 0;
      for (const l of lots[id]) {
        if (l.qty0 === 0 && l.qty === 0) continue;
        l.weeksLeft -= 1;
        if (l.weeksLeft <= 0 && l.qty > 0) { waste += l.qty; l.wasted += l.qty; l.qty = 0; }
      }
      acc[id].waste += waste;
      acc[id].weeks.push({ demand: demand[id], sold, stockout: demand[id] - request[id], capacityLost: request[id] - sold, waste, endQty: lots[id].reduce((s, l) => s + l.qty, 0) });
    }
  }

  // 期末：ロットごとに原価を「販売分・廃棄分・期末在庫」に配分（合計は必ずロットの金額に一致）
  const endInventory = perProduct<Lot[]>(() => []);
  const costs = perProduct(() => ({ sold: 0, waste: 0, end: 0 }));
  for (const id of PRODUCT_IDS) {
    for (const l of lots[id]) {
      if (l.qty0 === 0) continue;
      let wasteCost = 0, endValue = 0;
      if (l.qty === 0) {
        wasteCost = l.wasted === l.qty0 ? l.value0 : Math.min(l.value0, money(l.value0 * l.wasted / l.qty0));
      } else {
        endValue = l.sold === 0 ? l.value0 : Math.min(l.value0, money(l.value0 * l.qty / l.qty0));
        endInventory[id].push({ qty: l.qty, value: endValue, weeksLeft: l.weeksLeft });
      }
      costs[id].waste += wasteCost;
      costs[id].end += endValue;
      costs[id].sold += l.value0 - wasteCost - endValue;
    }
  }

  // 販管費と期末の支払い
  const labor = dec.staff * env.wage;
  const rent = C.rent;
  const utilities = C.utilitiesBase + (fridgeOwned ? C.fridge.utilitiesExtra : 0);
  const advertising = dec.ad;
  const bookBefore = dec.buyFridge ? C.fridge.price : (opts.noFridge ? 0 : state.fridge.bookValue);
  const depreciation = fridgeOwned ? Math.min(bookBefore, money(C.fridge.price / C.fridge.lifeQuarters)) : 0;
  const sga = labor + rent + utilities + advertising + depreciation;
  const loanAfter = state.loan + dec.borrow - dec.repay;
  const interest = d.features.loan ? money(loanAfter * C.loan.annualRate / 4) : 0;
  cash -= labor + utilities + advertising + interest;
  track('期末（人件費・水道光熱費・広告費・利息の支払い後）');

  const rows: ProductResult[] = PRODUCT_IDS.map(id => {
    const p = productById(id), a = acc[id], c = costs[id];
    const unitCost = env.products[id].cost;
    const lostQty = a.stockout + a.capacityLost;
    return {
      id, name: p.name, emoji: p.emoji, price: dec.prices[id], unitCost,
      expDemand: Math.round(expQ[id]), demand: a.demand,
      beginQty: begin[id].qty, beginValue: begin[id].value,
      orderPerWeek: dec.orders[id], purchaseQty: a.purchaseQty, purchaseCost: a.purchaseCost,
      availQty: begin[id].qty + a.purchaseQty,
      sold: a.sold, stockout: a.stockout, capacityLost: a.capacityLost, waste: a.waste,
      carry: endInventory[id].reduce((s, l) => s + l.qty, 0),
      soldCost: c.sold, wasteCost: c.waste, endValue: c.end,
      revenue: a.revenue, cogs: c.sold + c.waste, grossProfit: a.revenue - c.sold - c.waste,
      lostQty, opportunityLoss: money(lostQty * Math.max(0, dec.prices[id] - unitCost)),
      shelfWeeks: shelfWeeks(id, fridgeOwned), weeks: a.weeks
    };
  });
  const sum = (k: keyof ProductResult) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const cogsSold = sum('soldCost'), cogsWaste = sum('wasteCost');
  const cogs = cogsSold + cogsWaste;
  const grossProfit = revenueTotal - cogs;
  const operatingProfit = grossProfit - sga;

  return {
    turn: t, year: env.year, quarter: env.quarter, season: env.season,
    decisions: dec, env, rows,
    capacityPerWeek, capacity: capacityPerWeek * WEEKS_PER_TURN,
    totals: {
      demand: sum('demand'), sold: sum('sold'), stockout: sum('stockout'), capacityLost: sum('capacityLost'),
      waste: sum('waste'), carry: sum('carry'), purchaseQty: sum('purchaseQty'), opportunityLoss: sum('opportunityLoss'), availQty: sum('availQty')
    },
    pl: {
      revenue: revenueTotal, cogsSold, cogsWaste, cogs, grossProfit,
      labor, rent, utilities, advertising, depreciation, sga,
      operatingProfit, interest, ordinaryProfit: operatingProfit - interest
    },
    inventory: { begin: sum('beginValue'), purchases: purchaseTotal, cogsSold, cogsWaste, end: sum('endValue') },
    cash: {
      begin: cashBegin, end: cash, change: cash - cashBegin,
      revenueIn: revenueTotal, purchasesOut: purchaseTotal, expensesOut: labor + rent + utilities + advertising,
      interestOut: interest, capexOut: capex, borrow: dec.borrow, repay: dec.repay,
      min: minCash, minWhen
    },
    loan: { begin: state.loan, end: loanAfter },
    fridge: { owned: fridgeOwned, boughtNow: dec.buyFridge, bookBegin: dec.buyFridge ? 0 : (opts.noFridge ? 0 : state.fridge.bookValue), bookEnd: fridgeOwned ? bookBefore - depreciation : 0 },
    endInventory,
    shortage: minCash < 0
  };
}

