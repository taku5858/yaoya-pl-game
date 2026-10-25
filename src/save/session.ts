/*
 * 画面の進行状態（セッション）と、その操作。計算は engine、文章は learning に任せる。
 */
import { gameConfig as C } from '../config/gameConfig';
import type { DifficultyKey } from '../config/gameConfig';
import { applyResult, defaultDecisions, newGame, normalizeDecisions, simulateTurn, undoLastTurn } from '../engine';
import type { CoreState, Decisions, TurnResult } from '../engine';
import { buildQuiz, gradePrediction, questionBank, questionIdFor, stageOf } from '../learning';

export type Phase = 'decide' | 'predict' | 'result' | 'shortage' | 'quiz' | 'finished';
export const PHASES: Phase[] = ['decide', 'predict', 'result', 'shortage', 'quiz', 'finished'];

export interface Session {
  core: CoreState;
  phase: Phase;
  draft: Decisions;
  choice: string | null;
  seenStages: number[];
  quizAnswers: (number | null)[];
  undone: { turn: number; decisions: Decisions } | null;
  pending: TurnResult | null;        // 資金ショートした判断の結果（保存しない・読み込み時に再計算）
}

export function startSession(difficulty: DifficultyKey, seed?: string): Session {
  const core = newGame({ difficulty, seed });
  return { core, phase: 'decide', draft: defaultDecisions(core), choice: null, seenStages: [], quizAnswers: [], undone: null, pending: null };
}

export const lastResult = (s: Session): TurnResult | null => s.core.history[s.core.history.length - 1]?.result ?? null;
export const currentQuestionId = (s: Session) => questionIdFor(s.core.turn, s.core.history.length > 0);

export function setDraft(s: Session, draft: Decisions): Session {
  return { ...s, draft };
}
export function toPredict(s: Session): Session {
  return { ...s, draft: normalizeDecisions(s.core, s.draft), phase: 'predict', choice: null };
}
export function backToDecide(s: Session): Session {
  return { ...s, phase: 'decide', pending: null };
}
/** 予想の選択（今の問題の選択肢にない値は受け付けない） */
export function choose(s: Session, key: string): Session {
  const q = questionBank[currentQuestionId(s)];
  return q.options.some(o => o.key === key) ? { ...s, choice: key } : s;
}

/** 判断を確定して1ターン進める。資金ショートなら進めずに shortage へ */
export function runTurn(s: Session): Session {
  if (!s.choice || s.phase !== 'predict') return s;
  const result = simulateTurn(s.core, s.draft);
  if (result.shortage) return { ...s, phase: 'shortage', pending: result };
  const prev = lastResult(s);
  const prediction = gradePrediction(currentQuestionId(s), s.choice, result, prev);
  return { ...s, core: applyResult(s.core, result, prediction), phase: 'result', pending: null, choice: null };
}

export function nextTurn(s: Session): Session {
  if (s.core.turn >= C.totalTurns) return toQuiz(s);
  return { ...s, phase: 'decide', undone: null, draft: defaultDecisions(s.core), choice: null };
}

/** 1ターン戻す（イージー、または資金ショートからのやり直し） */
export function undoTurn(s: Session, keepForCompare: boolean): Session {
  const last = s.core.history[s.core.history.length - 1];
  if (!last) return s;
  const core = undoLastTurn(s.core);
  return {
    ...s, core, phase: 'decide', choice: null, pending: null,
    draft: { ...last.decisions, buyFridge: last.result.fridge.boughtNow },
    undone: keepForCompare ? { turn: last.turn, decisions: last.decisions } : null
  };
}

export function retryTurn(s: Session): Session {
  return { ...s, phase: 'decide', pending: null, choice: null };
}

export function dismissIntro(s: Session): Session {
  const st = stageOf(s.core.turn);
  return s.seenStages.includes(st) ? s : { ...s, seenStages: [...s.seenStages, st] };
}

export function toQuiz(s: Session): Session {
  if (s.core.turn < C.totalTurns) return s;
  return { ...s, phase: 'quiz', quizAnswers: [] };
}
export function answerQuiz(s: Session, choice: number): Session {
  const idx = s.quizAnswers.length;
  if (s.phase !== 'quiz' || idx >= 5) return s;
  return { ...s, quizAnswers: [...s.quizAnswers, choice] };
}
export function finishQuiz(s: Session): Session {
  return s.quizAnswers.length >= 5 ? { ...s, phase: 'finished' } : s;
}
export function quizView(s: Session) {
  const questions = buildQuiz(s.core);
  const correct = s.quizAnswers.map((a, i) => a === questions[i]?.answer);
  return { questions, correct };
}
