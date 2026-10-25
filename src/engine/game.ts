import { gameConfig as C, PRODUCT_IDS } from '../config/gameConfig';
import type { DifficultyKey } from '../config/gameConfig';
import { generateEvents, normalizeDecisions, perProduct, suggestedOrder } from './model';
import { randomSeed, sanitizeSeed } from './rng';
import { simulateTurn } from './simulate';
import type { CoreState, Decisions, PredictionRecord, Snapshot, TurnResult } from './types';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function newGame(opts: { difficulty: DifficultyKey; seed?: string }): CoreState {
  const seed = sanitizeSeed(opts.seed) || randomSeed();
  const d = C.difficulties[opts.difficulty];
  return {
    seed, difficulty: opts.difficulty, turn: 0,
    cash: d.startCash, loan: 0,
    fridge: { owned: false, bookValue: 0, boughtTurn: null },
    inventory: perProduct(() => []),
    cumOP: 0, cumOrdinary: 0, minCash: d.startCash,
    events: generateEvents(seed, opts.difficulty),
    history: []
  };
}

/** 次のターンの判断の初期値：前の期と同じ（最初の期は標準価格・予測どおりの仕入れ） */
export function defaultDecisions(state: CoreState): Decisions {
  const last = state.history[state.history.length - 1];
  if (last) {
    const dec = clone(last.decisions);
    dec.buyFridge = false; dec.borrow = 0; dec.repay = 0;
    return normalizeDecisions(state, dec);
  }
  const dec: Decisions = {
    prices: perProduct(id => C.products.find(p => p.id === id)!.refPrice),
    orders: perProduct(() => 0),
    staff: C.staff.initial, ad: 0, buyFridge: false, borrow: 0, repay: 0
  };
  for (const id of PRODUCT_IDS) dec.orders[id] = suggestedOrder(state, dec, id);
  return dec;
}

export function snapshot(state: CoreState): Snapshot {
  return clone({
    turn: state.turn, cash: state.cash, loan: state.loan, fridge: state.fridge, inventory: state.inventory,
    cumOP: state.cumOP, cumOrdinary: state.cumOrdinary, minCash: state.minCash
  });
}

/** 結果を反映した新しい state を返す（元の state は変更しない） */
export function applyResult(state: CoreState, result: TurnResult, prediction: PredictionRecord | null = null): CoreState {
  const before = snapshot(state);
  const s: CoreState = { ...state, history: state.history.slice() };
  s.inventory = clone(result.endInventory);
  s.cash = result.cash.end;
  s.minCash = Math.min(state.minCash, result.cash.min, result.cash.end);
  s.loan = result.loan.end;
  s.fridge = result.fridge.owned
    ? { owned: true, bookValue: result.fridge.bookEnd, boughtTurn: result.fridge.boughtNow ? result.turn : state.fridge.boughtTurn }
    : clone(state.fridge);
  s.cumOP = state.cumOP + result.pl.operatingProfit;
  s.cumOrdinary = state.cumOrdinary + result.pl.ordinaryProfit;
  s.history.push({ turn: result.turn, decisions: result.decisions, result, prediction, before });
  s.turn = state.turn + 1;
  return s;
}

/** 最後のターンを取り消して、その前の状態に戻す */
export function undoLastTurn(state: CoreState): CoreState {
  if (!state.history.length) return state;
  const history = state.history.slice(0, -1);
  const last = state.history[state.history.length - 1];
  return { ...state, ...clone(last.before), history };
}

/** 結果を出す前の状態（比較・振り返り用） */
export function stateBefore(state: CoreState, index: number): CoreState {
  const rec = state.history[index];
  return { ...state, ...clone(rec.before), history: state.history.slice(0, index) };
}

/**
 * 判断の履歴から、シードを使ってゲームを最初から再計算する（セーブデータの復元に使用）。
 * 資金ショートになる判断が含まれていたら、そこで止める。
 */
export function replay(
  difficulty: DifficultyKey, seed: string, turns: { decisions: unknown; prediction: PredictionRecord | null }[]
): { state: CoreState; stoppedAt: number | null } {
  let state = newGame({ difficulty, seed });
  for (let i = 0; i < turns.length && i < C.totalTurns; i++) {
    const r = simulateTurn(state, turns[i].decisions);
    if (r.shortage) return { state, stoppedAt: i };
    state = applyResult(state, r, turns[i].prediction);
  }
  return { state, stoppedAt: null };
}
