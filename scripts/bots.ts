/*
 * シミュレーション用の戦略ボット（難易度・目標値の調整とテストに使用）
 * ボットは実際の誤差を知らず、画面に出る情報（需要予測）と、自分で想定した誤差だけで判断する。
 */
import { gameConfig as C, PRODUCT_IDS } from '../src/config/gameConfig';
import type { DifficultyKey } from '../src/config/gameConfig';
import {
  applyResult, checkResult, defaultDecisions, diffOf, newGame, normalizeDecisions, outlook, perProduct, priceRange,
  productById, rngFor, simulateTurn, suggestedOrder
} from '../src/engine';
import type { CoreState, Decisions, NoiseSet } from '../src/engine';

type Strategy = (s: CoreState) => Decisions;

const fitAll = (s: CoreState, dec: Decisions, margin = 0) => {
  for (const id of PRODUCT_IDS) dec.orders[id] = suggestedOrder(s, dec, id, margin);
  return dec;
};
const staffFor = (s: CoreState, dec: Decisions, margin = 0) => {
  const o = outlook(s, dec);
  return Math.min(C.staff.max, Math.max(1, Math.ceil(o.totalDemand * (1 + margin) / (C.staff.capacityPerWeek * C.weeksPerTurn) - 0.05)));
};
const withFridge = (base: Strategy): Strategy => s => {
  const dec = base(s);
  if (diffOf(s).features.fridge && !s.fridge.owned && s.turn <= 1) dec.buyFridge = true;
  return financeFor(s, dec);
};

/** 資金繰り：期中の最低資金が少なければ借り、余裕があれば返す */
function financeFor(s: CoreState, dec: Decisions): Decisions {
  if (!diffOf(s).features.loan) return dec;
  const pess: NoiseSet = { quarter: perProduct(() => -diffOf(s).quarterNoise), weeks: Array.from({ length: C.weeksPerTurn }, () => perProduct(() => 0)) };
  const r = simulateTurn(s, { ...dec, borrow: 0, repay: 0 }, { noise: pess });
  const u = C.loan.unit;
  if (r.cash.min < 300000) dec.borrow = Math.min(C.loan.max - s.loan, Math.ceil((300000 - r.cash.min) / u) * u);
  else if (s.loan > 0 && r.cash.min > 2000000) dec.repay = Math.min(s.loan, Math.floor((r.cash.min - 1500000) / u) * u);
  return dec;
}

export const strategies: Record<string, Strategy> = {
  /** 最初の判断をずっと続ける */
  hold: s => defaultDecisions(s),
  /** 「需要予測に合わせる」ボタンだけを毎ターン押す（価格・人員・広告は最初のまま） */
  fitOnly: s => financeFor(s, fitAll(s, defaultDecisions(s))),
  /** 予測に合わせて仕入れ、必要な人数をそろえる */
  basic: s => {
    const dec = fitAll(s, defaultDecisions(s));
    dec.staff = staffFor(s, dec);
    return financeFor(s, dec);
  },
  /** 値上げし続ける */
  gouge: s => {
    const dec = defaultDecisions(s);
    for (const id of PRODUCT_IDS) dec.prices[id] = priceRange(productById(id)).max;
    fitAll(s, dec); dec.staff = staffFor(s, dec);
    return financeFor(s, dec);
  },
  /** 欠品がこわいので3割多く仕入れる */
  overbuy: s => {
    const dec = fitAll(s, defaultDecisions(s), 0.3);
    dec.staff = staffFor(s, dec, 0.3);
    return financeFor(s, dec);
  },
  /** 人と広告を最大にする */
  bigspend: s => {
    const dec = defaultDecisions(s);
    dec.ad = C.adOptions[C.adOptions.length - 1].amount;
    fitAll(s, dec, 0.1); dec.staff = C.staff.max;
    return financeFor(s, dec);
  },
  /** よく考える：想定誤差つきで期待営業利益が大きくなる判断を探す */
  smart: s => financeFor(s, optimize(s, false)),
  smartFridge: s => financeFor(s, optimize(s, true)),
  fitOnlyFridge: s => withFridge(s2 => fitAll(s2, defaultDecisions(s2)))(s),
  overbuyFridge: s => withFridge(s2 => { const d = fitAll(s2, defaultDecisions(s2), 0.3); d.staff = staffFor(s2, d, 0.3); return d; })(s)
};

/** プレイヤーが想定する誤差（実際の誤差とは別の乱数） */
function planningNoises(s: CoreState): NoiseSet[] {
  const d = diffOf(s);
  const r = rngFor(s.seed, 'planner', s.turn);
  const sets: NoiseSet[] = [];
  for (const q of [-0.6, -0.2, 0.2, 0.6]) {
    sets.push({
      quarter: perProduct(() => q * d.quarterNoise),
      weeks: Array.from({ length: C.weeksPerTurn }, () => perProduct(() => (r() * 2 - 1) * d.weekNoise))
    });
  }
  return sets;
}

function optimize(s: CoreState, fridge: boolean): Decisions {
  const d = diffOf(s);
  const noises = planningNoises(s);
  const factors = [0.9, 0.95, 1, 1.05, 1.1, 1.15];
  const base = defaultDecisions(s);
  const cur = { price: { ...base.prices }, factor: perProduct(() => 1), staff: base.staff, ad: 0 };
  for (const p of C.products) cur.price[p.id] = p.refPrice;
  const buyFridge = fridge && d.features.fridge && !s.fridge.owned && s.turn <= 1;
  const build = (c: typeof cur): Decisions => {
    const dec: Decisions = { prices: { ...c.price }, orders: perProduct(() => 0), staff: c.staff, ad: c.ad, buyFridge, borrow: 0, repay: 0 };
    for (const id of PRODUCT_IDS) dec.orders[id] = suggestedOrder(s, dec, id, c.factor[id] - 1);
    return dec;
  };
  // 資金ショートを避けるため、評価中は借入できる分だけ借りた想定にする（利息は営業利益に影響しない）
  const tmp: CoreState = d.features.loan ? { ...s, cash: s.cash + (C.loan.max - s.loan) } : s;
  const score = (c: typeof cur) => {
    const dec = build(c);
    let total = 0;
    for (const n of noises) {
      const r = simulateTurn(tmp, dec, { noise: n });
      total += r.pl.operatingProfit - 0.15 * (r.inventory.end - r.inventory.begin);
    }
    return total / noises.length;
  };
  cur.staff = staffFor(s, build(cur));
  let best = score(cur);
  const tryVal = (mut: (c: typeof cur) => void) => {
    const c = JSON.parse(JSON.stringify(cur)) as typeof cur;
    mut(c);
    const v = score(c);
    if (v > best + 1) { best = v; Object.assign(cur, c); return true; }
    return false;
  };
  for (let round = 0; round < 3; round++) {
    let improved = false;
    for (const p of C.products) {
      const rg = priceRange(p);
      for (let pr = rg.min; pr <= rg.max; pr += p.priceStep * 2) improved = tryVal(c => { c.price[p.id] = pr; }) || improved;
      for (const f of factors) improved = tryVal(c => { c.factor[p.id] = f; }) || improved;
    }
    for (let st = C.staff.min; st <= C.staff.max; st++) improved = tryVal(c => { c.staff = st; }) || improved;
    if (d.features.ad) for (const o of C.adOptions) improved = tryVal(c => { c.ad = o.amount; }) || improved;
    if (!improved) break;
  }
  return normalizeDecisions(s, build(cur));
}

export interface GameRun {
  cumOP: number; cumOrdinary: number; cash: number; loan: number; minCash: number;
  shortage: boolean; shortageTurn: number | null; errors: string[];
  wasteCost: number; wasteRate: number; lostRate: number; fridgeOwned: boolean; fridgeBook: number; depreciation: number;
  state: CoreState;
}

/** 1ゲームを最後まで遊ぶ。資金ショートした場合はその期を「実行したもの」として続けて記録する（判定用） */
export function playGame(difficulty: DifficultyKey, seed: string, strategy: string): GameRun {
  let s = newGame({ difficulty, seed });
  const errors: string[] = [];
  let shortageTurn: number | null = null;
  for (let t = 0; t < C.totalTurns; t++) {
    const r = simulateTurn(s, strategies[strategy](s));
    const e = checkResult(r);
    if (e.length) errors.push(`t${t}: ${e.join(' / ')}`);
    if (r.shortage && shortageTurn === null) shortageTurn = t;
    s = applyResult(s, r);
  }
  const hs = s.history.map(h => h.result);
  const sum = (f: (r: typeof hs[number]) => number) => hs.reduce((a, r) => a + f(r), 0);
  return {
    cumOP: s.cumOP, cumOrdinary: s.cumOrdinary, cash: s.cash, loan: s.loan, minCash: s.minCash,
    shortage: shortageTurn !== null, shortageTurn, errors,
    wasteCost: sum(r => r.pl.cogsWaste), wasteRate: sum(r => r.pl.cogsWaste) / Math.max(1, sum(r => r.pl.cogs)),
    lostRate: sum(r => r.totals.stockout + r.totals.capacityLost) / Math.max(1, sum(r => r.totals.demand)),
    fridgeOwned: s.fridge.owned, fridgeBook: s.fridge.bookValue, depreciation: sum(r => r.pl.depreciation), state: s
  };
}
