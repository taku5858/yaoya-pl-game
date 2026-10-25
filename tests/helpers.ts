import { gameConfig as C, PRODUCT_IDS } from '../src/config/gameConfig';
import { applyResult, diffOf, newGame, priceRange, productById, rngFor, simulateTurn } from '../src/engine';
import type { CoreState, Decisions, TurnResult } from '../src/engine';
import type { DifficultyKey } from '../src/config/gameConfig';

/** あえて極端な値も含むランダムな判断 */
export function randomDecision(s: CoreState, r: () => number): Decisions {
  const d = diffOf(s);
  const dec: Decisions = {
    prices: {} as Decisions['prices'], orders: {} as Decisions['orders'],
    staff: 1 + Math.floor(r() * 10), ad: C.adOptions[Math.floor(r() * 4)].amount,
    buyFridge: r() < 0.15, borrow: 0, repay: 0
  };
  for (const id of PRODUCT_IDS) {
    const p = productById(id), rg = priceRange(p);
    dec.prices[id] = rg.min + Math.floor(r() * ((rg.max - rg.min) / p.priceStep + 1)) * p.priceStep;
    dec.orders[id] = r() < 0.05 ? 0 : Math.round(p.baseDemand / 13 * (0.3 + r() * 1.6) / 10) * 10;
  }
  if (d.features.loan) {
    if (r() < 0.3) dec.borrow = Math.floor(r() * 4) * C.loan.unit;
    else if (r() < 0.3) dec.repay = Math.floor(r() * 3) * C.loan.unit;
  }
  return dec;
}

/** ランダムな判断で20ターン遊ぶ（資金ショートでも計算は続ける） */
export function randomGame(difficulty: DifficultyKey, seed: string): { state: CoreState; results: TurnResult[] } {
  const r = rngFor('test', difficulty, seed);
  let s = newGame({ difficulty, seed });
  const results: TurnResult[] = [];
  for (let t = 0; t < C.totalTurns; t++) {
    const res = simulateTurn(s, randomDecision(s, r));
    results.push(res);
    s = applyResult(s, res);
  }
  return { state: s, results };
}
