import { describe, expect, it } from 'vitest';
import { gameConfig as C, PRODUCT_IDS } from '../src/config/gameConfig';
import { suggestedOrder } from '../src/engine';
import { questionBank } from '../src/learning';
import {
  answerQuiz, choose, currentQuestionId, finishQuiz, nextTurn, quizView, retryTurn, runTurn, setDraft, startSession, toPredict, undoTurn
} from '../src/save/session';
import type { Session } from '../src/save/session';
import { parseSave, toSaveData } from '../src/save/saveData';

/** 画面の操作と同じ順番で1ターン進める（予測に合わせるボタン→予想→結果→次へ） */
function playOne(s: Session): Session {
  const d = { ...s.draft, orders: { ...s.draft.orders } };
  for (const id of PRODUCT_IDS) d.orders[id] = suggestedOrder(s.core, d, id);
  s = toPredict(setDraft(s, d));
  s = choose(s, questionBank[currentQuestionId(s)].options[0].key);
  s = runTurn(s);
  if (s.phase === 'shortage') throw new Error('資金ショート');
  expect(s.phase).toBe('result');
  return nextTurn(s);
}

describe('5年間の進行', () => {
  for (const diff of ['easy', 'normal', 'hard'] as const) {
    it(`${diff}: 20ターン→理解度テスト→終了まで進める`, () => {
      let s = startSession(diff, 'PROG');
      for (let t = 0; t < C.totalTurns; t++) {
        expect(s.core.turn).toBe(t);
        s = playOne(s);
        // 毎ターン保存→読み込みしても同じ状態
        const r = parseSave(JSON.stringify(toSaveData(s)));
        expect(r.ok && r.session.core.cumOP).toBe(s.core.cumOP);
      }
      expect(s.phase).toBe('quiz');
      expect(s.core.history.length).toBe(20);
      expect(s.core.history.every(h => h.prediction !== null)).toBe(true);
      const { questions } = quizView(s);
      expect(questions).toHaveLength(5);
      for (const q of questions) s = answerQuiz(s, q.answer);
      s = finishQuiz(s);
      expect(s.phase).toBe('finished');
      expect(quizView(s).correct.every(Boolean)).toBe(true);
    });
  }

  it('イージー：1ターン戻すと前の状態になり、同じ判断なら同じ結果', () => {
    let s = startSession('easy', 'UNDO');
    s = playOne(s); s = playOne(s);
    const before = s.core.history[1].result;
    s = toPredict(s);
    s = runTurn(choose(s, questionBank[currentQuestionId(s)].options[0].key));
    const cum = s.core.cumOP;
    s = undoTurn(s, true);
    expect(s.core.turn).toBe(2);
    expect(s.undone?.turn).toBe(2);
    expect(s.core.history[1].result).toEqual(before);
    s = runTurn(choose(toPredict(s), questionBank[currentQuestionId(s)].options[0].key));
    expect(s.core.cumOP).toBe(cum);
  });

  it('資金ショートの判断は進まず、やり直せる', () => {
    let s = startSession('hard', 'SHORT');
    const d = { ...s.draft, orders: { tomato: 9990, cabbage: 9990, carrot: 9990 }, staff: 10 };
    s = runTurn(choose(toPredict(setDraft(s, d)), questionBank[currentQuestionId(s)].options[0].key));
    expect(s.phase).toBe('shortage');
    expect(s.core.turn).toBe(0);
    expect(s.pending?.shortage).toBe(true);
    s = retryTurn(s);
    expect(s.phase).toBe('decide');
    s = playOne(s);
    expect(s.core.turn).toBe(1);
  });
});
