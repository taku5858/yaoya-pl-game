import { describe, expect, it } from 'vitest';
import { gameConfig as C, PRODUCT_IDS } from '../src/config/gameConfig';
import {
  applyResult, checkResult, defaultDecisions, lotsQty, money, newGame, normalizeDecisions, simulateTurn
} from '../src/engine';
import type { CoreState, Decisions } from '../src/engine';
import { cashBridgeItems } from '../src/learning';
import { randomGame } from './helpers';

const diffs = ['easy', 'normal', 'hard'] as const;

describe('PL・在庫・資金の整合性（ランダムな判断）', () => {
  for (const diff of diffs) {
    it(`${diff}: 30ゲーム×20ターンで整合性エラーなし`, () => {
      let turns = 0;
      for (let g = 0; g < 30; g++) {
        const { state, results } = randomGame(diff, 'FZ' + g);
        let totalDep = 0, totalCapex = 0, cashSum = 0, bridgeSum = 0;
        for (const r of results) {
          expect(checkResult(r)).toEqual([]);
          totalDep += r.pl.depreciation; totalCapex += r.cash.capexOut;
          cashSum += r.cash.change;
          bridgeSum += cashBridgeItems(r).reduce((a, b) => a + b.value, 0);
          turns++;
        }
        expect(totalDep).toBeLessThanOrEqual(totalCapex);
        expect(cashSum).toBe(bridgeSum);
        expect(state.history.length).toBe(C.totalTurns);
        expect(state.cumOP).toBe(results.reduce((a, r) => a + r.pl.operatingProfit, 0));
      }
      expect(turns).toBe(600);
    });
  }
});

describe('仕入れ・売上原価・在庫', () => {
  const s0 = newGame({ difficulty: 'normal', seed: 'CASE' });

  it('仕入れゼロなら売上も原価もゼロで、需要はすべて欠品', () => {
    const dec = defaultDecisions(s0);
    for (const id of PRODUCT_IDS) dec.orders[id] = 0;
    const r = simulateTurn(s0, dec);
    expect(r.pl.revenue).toBe(0);
    expect(r.pl.cogs).toBe(0);
    expect(r.totals.stockout).toBe(r.totals.demand);
    expect(r.pl.operatingProfit).toBe(-r.pl.sga);
  });

  it('多めに仕入れると、売れる期間内の残りは在庫に、過ぎた分は廃棄になる（売上原価 < 仕入れ）', () => {
    const dec = defaultDecisions(s0);
    for (const id of PRODUCT_IDS) dec.orders[id] = Math.round(dec.orders[id] * 1.5 / 10) * 10;
    dec.staff = 10;
    const r = simulateTurn(s0, dec);
    expect(r.totals.waste).toBeGreaterThan(0);
    expect(r.inventory.end).toBeGreaterThan(0);
    expect(r.pl.cogs).toBeLessThan(r.inventory.purchases);
    expect(r.pl.cogs).toBe(r.pl.cogsSold + r.pl.cogsWaste);
    expect(r.inventory.begin + r.inventory.purchases).toBe(r.pl.cogs + r.inventory.end);
  });

  it('トマト（売れる期間1週）は期末に持ち越さない。にんじんは期限内の分だけ持ち越す', () => {
    const dec = defaultDecisions(s0);
    for (const id of PRODUCT_IDS) dec.orders[id] = 3000;
    dec.staff = 10;
    const r = simulateTurn(s0, dec);
    const tomato = r.rows.find(x => x.id === 'tomato')!;
    expect(tomato.carry).toBe(0);
    expect(r.endInventory.tomato).toEqual([]);
    for (const l of r.endInventory.carrot) expect(l.weeksLeft).toBeGreaterThan(0);
    expect(r.endInventory.carrot.every(l => l.weeksLeft <= 4)).toBe(true);
  });

  it('期末在庫が次期の期首在庫になり、次期に売れると原価になる', () => {
    const dec = defaultDecisions(s0);
    for (const id of PRODUCT_IDS) dec.orders[id] = 3000;
    dec.staff = 10;
    const r1 = simulateTurn(s0, dec);
    const s1 = applyResult(s0, r1);
    expect(lotsQty(s1.inventory.carrot)).toBe(r1.rows.find(x => x.id === 'carrot')!.carry);
    const dec2 = defaultDecisions(s1);
    for (const id of PRODUCT_IDS) dec2.orders[id] = 0;
    const r2 = simulateTurn(s1, dec2);
    expect(r2.inventory.begin).toBe(r1.inventory.end);
    expect(r2.inventory.purchases).toBe(0);
    expect(r2.pl.cogsSold).toBeGreaterThan(0);
    expect(checkResult(r2)).toEqual([]);
  });

  it('古いロットから売る（先入れ先出し）', () => {
    // にんじんを大量に持ち越した状態で、少しだけ仕入れる
    const s: CoreState = { ...s0, inventory: { ...s0.inventory, carrot: [{ qty: 500, value: 23000, weeksLeft: 1 }] } };
    const dec = defaultDecisions(s);
    dec.staff = 10;
    const r = simulateTurn(s, dec);
    const c = r.rows.find(x => x.id === 'carrot')!;
    // 1週目の需要が500以上あれば、持ち越しの500個は1週目に売り切れて廃棄にならない
    expect(c.weeks[0].demand).toBeGreaterThan(500);
    expect(c.weeks[0].waste).toBe(0);
  });

  it('販売数は需要・在庫・販売能力を超えない（人員1人）', () => {
    const dec = defaultDecisions(s0);
    dec.staff = 1;
    const r = simulateTurn(s0, dec);
    for (const w of r.rows[0].weeks.keys()) {
      expect(r.rows.reduce((a, x) => a + x.weeks[w].sold, 0)).toBeLessThanOrEqual(C.staff.capacityPerWeek);
    }
    expect(r.totals.capacityLost).toBeGreaterThan(0);
  });

  it('機会損失はPLに入らない', () => {
    const r = simulateTurn(s0, { ...defaultDecisions(s0), staff: 2 });
    expect(r.totals.opportunityLoss).toBeGreaterThan(0);
    expect(Object.keys(r.pl)).not.toContain('opportunityLoss');
    expect(r.pl.operatingProfit).toBe(r.pl.revenue - r.pl.cogs - r.pl.sga);
  });

  it('値上げで需要が減り、広告で需要が増える', () => {
    const base = simulateTurn(s0, defaultDecisions(s0), { noise: 'zero' });
    const up = simulateTurn(s0, { ...defaultDecisions(s0), prices: { ...defaultDecisions(s0).prices, tomato: 150 } }, { noise: 'zero' });
    const ad = simulateTurn(s0, { ...defaultDecisions(s0), ad: 200000 }, { noise: 'zero' });
    expect(up.rows[0].demand).toBeLessThan(base.rows[0].demand);
    expect(ad.totals.demand).toBeGreaterThan(base.totals.demand);
    expect(ad.pl.advertising).toBe(200000);
  });
});

describe('冷蔵設備（設備投資と減価償却）', () => {
  it('代金は買った期に全額支払い、費用は20期に分けた減価償却費だけ', () => {
    let s = newGame({ difficulty: 'hard', seed: 'FR' });
    const dec: Decisions = { ...defaultDecisions(s), buyFridge: true, borrow: 2000000 };
    const r = simulateTurn(s, dec);
    expect(r.cash.capexOut).toBe(C.fridge.price);
    expect(r.pl.depreciation).toBe(C.fridge.price / C.fridge.lifeQuarters);
    expect(r.fridge.bookEnd).toBe(C.fridge.price - r.pl.depreciation);
    expect(r.pl.utilities).toBe(C.utilitiesBase + C.fridge.utilitiesExtra);
    s = applyResult(s, r);
    let dep = r.pl.depreciation;
    for (let t = 1; t < 20; t++) { const x = simulateTurn(s, defaultDecisions(s)); dep += x.pl.depreciation; s = applyResult(s, x); }
    expect(dep).toBe(C.fridge.price);
    expect(s.fridge.bookValue).toBe(0);
  });

  it('途中で買うと5年目終了時に設備の価値が残るが、累計営業利益には足さない', () => {
    let s = newGame({ difficulty: 'hard', seed: 'FR2' });
    for (let t = 0; t < 20; t++) {
      const dec = { ...defaultDecisions(s), buyFridge: t === 10, borrow: t === 10 ? 1000000 : 0 };
      s = applyResult(s, simulateTurn(s, dec));
    }
    expect(s.fridge.bookValue).toBe(C.fridge.price - 10 * 50000);
    expect(s.cumOP).toBe(s.history.reduce((a, h) => a + h.result.pl.operatingProfit, 0));
  });

  it('売れる期間が延び、同じ需要なら廃棄は増えない', () => {
    const s = newGame({ difficulty: 'hard', seed: 'FR3' });
    const dec = { ...defaultDecisions(s), buyFridge: true, borrow: 2000000 };
    const withF = simulateTurn(s, dec);
    const without = simulateTurn(s, dec, { noFridge: true });
    expect(withF.rows[0].shelfWeeks).toBe(2);
    expect(without.rows[0].shelfWeeks).toBe(1);
    expect(withF.totals.waste).toBeLessThanOrEqual(without.totals.waste);
  });

  it('ふつうでは冷蔵設備・借入は使えず、2台目も買えない', () => {
    const n = newGame({ difficulty: 'normal', seed: 'X' });
    expect(normalizeDecisions(n, { ...defaultDecisions(n), buyFridge: true, borrow: 1000000 })).toMatchObject({ buyFridge: false, borrow: 0 });
    const h = newGame({ difficulty: 'hard', seed: 'X' });
    const owned = { ...h, fridge: { owned: true, bookValue: 500000, boughtTurn: 0 } };
    expect(normalizeDecisions(owned, { ...defaultDecisions(owned), buyFridge: true }).buyFridge).toBe(false);
  });
});

describe('借入と支払利息', () => {
  it('借入は売上にならず、返済は費用にならない。利息は営業利益の下で引く', () => {
    let s = newGame({ difficulty: 'hard', seed: 'LN' });
    const r1 = simulateTurn(s, { ...defaultDecisions(s), borrow: 3000000 });
    const r0 = simulateTurn(s, defaultDecisions(s));
    expect(r1.pl.revenue).toBe(r0.pl.revenue);
    expect(r1.pl.operatingProfit).toBe(r0.pl.operatingProfit);
    expect(r1.pl.interest).toBe(money(3000000 * C.loan.annualRate / 4));
    expect(r1.pl.ordinaryProfit).toBe(r1.pl.operatingProfit - r1.pl.interest);
    expect(r1.cash.end - r0.cash.end).toBe(3000000 - r1.pl.interest);
    s = applyResult(s, r1);
    const r2 = simulateTurn(s, { ...defaultDecisions(s), repay: 2000000 });
    const r2b = simulateTurn(s, defaultDecisions(s));
    expect(r2.pl.operatingProfit).toBe(r2b.pl.operatingProfit);
    expect(r2.loan.end).toBe(1000000);
    expect(r2.pl.interest).toBe(money(1000000 * C.loan.annualRate / 4));
  });
});

describe('入力値の検証', () => {
  const s = newGame({ difficulty: 'hard', seed: 'IN' });
  it('負の仕入れ・NaN・文字列・範囲外は有効な値に直す', () => {
    const n = normalizeDecisions(s, { prices: { tomato: -50, cabbage: 'abc', carrot: 1e9 }, orders: { tomato: -100, cabbage: NaN, carrot: 1e12 }, staff: 99, ad: 12345, borrow: -1, repay: 1e9, buyFridge: 'yes' });
    expect(n.orders.tomato).toBe(0);
    expect(n.orders.cabbage).toBe(0);
    expect(n.orders.carrot).toBe(C.purchase.maxPerWeek);
    expect(n.prices.tomato).toBeGreaterThan(0);
    expect(n.prices.cabbage).toBe(200);
    expect(n.staff).toBe(C.staff.max);
    expect(n.ad).toBe(0);
    expect(n.borrow).toBe(0);
    expect(n.repay).toBe(0);
    expect(n.buyFridge).toBe(false);
  });
  it('判断がオブジェクトでなくても落ちない', () => {
    expect(() => simulateTurn(s, null)).not.toThrow();
    expect(() => simulateTurn(s, 'bad')).not.toThrow();
  });
});

describe('乱数の再現性', () => {
  it('同じシード・同じ判断なら同じ結果、判断を変えても需要の誤差は同じ', () => {
    const a = newGame({ difficulty: 'hard', seed: 'SAME' }), b = newGame({ difficulty: 'hard', seed: 'SAME' });
    expect(a.events).toEqual(b.events);
    const ra = simulateTurn(a, defaultDecisions(a)), rb = simulateTurn(b, defaultDecisions(b));
    expect(ra).toEqual(rb);
    const alt = { ...defaultDecisions(a), staff: 8, prices: { ...defaultDecisions(a).prices, tomato: 140 } };
    const rc = simulateTurn(a, alt);
    // 需要は価格で変わるが、価格を変えていない商品の週ごとの需要は同じ
    expect(rc.rows[1].weeks.map(w => w.demand)).toEqual(ra.rows[1].weeks.map(w => w.demand));
    const c = newGame({ difficulty: 'hard', seed: 'OTHER' });
    expect(simulateTurn(c, defaultDecisions(c)).totals.demand).not.toBe(ra.totals.demand);
  });
});
