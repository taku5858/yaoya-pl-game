import { describe, expect, it } from 'vitest';
import { gameConfig as C } from '../src/config/gameConfig';
import { applyResult, defaultDecisions, newGame, simulateTurn, stateBefore } from '../src/engine';
import {
  breakEven, buildQuiz, cashBridgeItems, costItems, evaluate, explainTurn, fridgeEffect, glossary, gradePrediction,
  hintsFor, man, opDrivers, opSentence, questionBank, questionIdFor
} from '../src/learning';
import { outlook } from '../src/engine';
import { randomGame } from './helpers';

const noBadText = (s: string) => !/undefined|NaN|Infinity|\[object/.test(s);

describe('解説の数字は計算結果と一致する', () => {
  for (const diff of ['easy', 'normal', 'hard'] as const) {
    it(`${diff}: 営業利益の変化の内訳の合計＝実際の差、文中の金額はPLの値`, () => {
      for (let g = 0; g < 6; g++) {
        const { state, results } = randomGame(diff, 'EX' + g);
        results.forEach((r, i) => {
          const ex = explainTurn(state, i);
          expect(noBadText(JSON.stringify(ex))).toBe(true);
          if (i > 0) {
            const p = results[i - 1];
            const sum = opDrivers(r, p).reduce((a, d) => a + d.effect, 0);
            expect(sum).toBe(r.pl.operatingProfit - p.pl.operatingProfit);
            const dOP = r.pl.operatingProfit - p.pl.operatingProfit;
            const s = opSentence(r, p);
            if (dOP !== 0) expect(s).toContain(`営業利益は ${man(Math.abs(dOP))}`);
            if (r.pl.revenue !== p.pl.revenue) expect(s).toContain(man(Math.abs(r.pl.revenue - p.pl.revenue)));
          }
          expect(ex.inventory).toContain(man(r.inventory.purchases));
          expect(ex.inventory).toContain(man(r.inventory.cogsSold));
          expect(ex.cash).toContain(man(r.pl.operatingProfit));
          expect(ex.cash).toContain(man(r.cash.change, { plus: true }));
          // 予想問題の答えも結果から決まる
          const qid = questionIdFor(i, i > 0);
          const q = questionBank[qid];
          for (const o of q.options) {
            const g2 = gradePrediction(qid, o.key, r, i > 0 ? results[i - 1] : null);
            expect(q.options.map(x => x.key)).toContain(g2.answer);
            expect(noBadText(q.explain(r, i > 0 ? results[i - 1] : null))).toBe(true);
          }
          for (const g3 of glossary) expect(noBadText(g3.example(r))).toBe(true);
        });
        const quiz = buildQuiz(state);
        expect(quiz).toHaveLength(5);
        for (const q of quiz) {
          expect(q.answer).toBeGreaterThanOrEqual(0);
          expect(new Set(q.options).size).toBe(q.options.length);
          expect(noBadText(JSON.stringify(q))).toBe(true);
        }
        const ev = evaluate(state, [true, false, true, false, true], quiz.map(q => q.tag));
        expect(noBadText(JSON.stringify(ev))).toBe(true);
        expect(ev.business.cumOP).toBe(state.cumOP);
      }
    });
  }

  it('利益→資金の説明の合計は、実際の資金の増減に一致', () => {
    const { results } = randomGame('hard', 'BR');
    for (const r of results) expect(cashBridgeItems(r).reduce((a, b) => a + b.value, 0)).toBe(r.cash.change);
  });

  it('例文：売上が増えたのに人件費が増えて利益が減った', () => {
    const s0 = newGame({ difficulty: 'easy', seed: 'TXT' });
    const r1 = simulateTurn(s0, defaultDecisions(s0));
    const s1 = applyResult(s0, r1);
    const d2 = { ...defaultDecisions(s1), staff: 9, prices: { ...defaultDecisions(s1).prices, carrot: 75 } };
    d2.orders = { ...d2.orders, carrot: d2.orders.carrot + 300 };
    const r2 = simulateTurn(s1, d2);
    const text = opSentence(r2, r1);
    expect(r2.pl.revenue).toBeGreaterThan(r1.pl.revenue);
    expect(r2.pl.operatingProfit).toBeLessThan(r1.pl.operatingProfit);
    expect(text).toMatch(/^売上は前期より .+ 増えましたが、.*人件費が .+ 増えた.*ため、営業利益は .+ 減りました。/);
  });
});

describe('固定費・変動費と損益分岐点', () => {
  it('費用の性質はPLの区分とは別に定義され、合計はPLの費用と一致', () => {
    const { results } = randomGame('hard', 'CB');
    for (const r of results) {
      const items = costItems(r);
      expect(items.reduce((a, b) => a + b.amount, 0)).toBe(r.pl.cogs + r.pl.sga);
      expect(items.find(x => x.key === 'labor')).toMatchObject({ plGroup: '販管費', nature: 'fixed' });
      expect(items.find(x => x.key === 'cogsSold')).toMatchObject({ plGroup: '売上原価', nature: 'variable' });
      expect(items.find(x => x.key === 'cogsWaste')).toMatchObject({ plGroup: '売上原価', nature: 'waste' });
      expect(items.find(x => x.key === 'advertising')).toMatchObject({ nature: 'discretionary' });
    }
  });
  it('（売上高−損益分岐点）×限界利益率 ≒ 営業利益（端数の範囲で一致）', () => {
    const { results } = randomGame('normal', 'BEP');
    for (const r of results) {
      const b = breakEven(r);
      if (b.breakEven === null || b.marginalRate <= 0) continue;
      expect(b.burden).toBe(r.pl.sga + r.pl.cogsWaste);
      expect(Math.abs((r.pl.revenue - b.breakEven) * b.marginalRate - r.pl.operatingProfit)).toBeLessThan(1000);
    }
  });
});

describe('冷蔵設備の効果の説明', () => {
  it('効果＝設備あり−設備なし（同じ乱数）の営業利益差。廃棄が少ないと元が取れない場合がある', () => {
    let s = newGame({ difficulty: 'hard', seed: 'FE' });
    const effects: number[] = [];
    for (let t = 0; t < 8; t++) {
      const dec = { ...defaultDecisions(s), buyFridge: t === 0, borrow: t === 0 ? 1000000 : 0 };
      const r = simulateTurn(s, dec);
      s = applyResult(s, r);
      const fe = fridgeEffect(stateBefore(s, t), r)!;
      expect(fe.cost).toBe(r.pl.depreciation + C.fridge.utilitiesExtra);
      expect(fe.wasteWith).toBeLessThanOrEqual(fe.wasteWithout);
      effects.push(fe.opEffect);
    }
    // 予測どおりの仕入れでは、廃棄削減より設備の費用が大きい期がある
    expect(effects.some(e => e < 0)).toBe(true);
  });
});

describe('ヒント', () => {
  it('どの状態でも文章が壊れない', () => {
    const { state } = randomGame('hard', 'HT');
    const s = { ...newGame({ difficulty: 'hard', seed: 'HT' }) };
    for (const st of [s, state]) {
      const dec = defaultDecisions(st.turn < 20 ? st : s);
      const hints = hintsFor(st.turn < 20 ? st : s, dec, outlook(st.turn < 20 ? st : s, dec));
      expect(hints.every(noBadText)).toBe(true);
    }
  });
});
