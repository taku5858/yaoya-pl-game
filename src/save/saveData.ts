/*
 * セーブデータ（ブラウザの localStorage）。
 *  - 保存するのは「シード・難易度・各ターンの判断と予想の選択」だけ。結果やスコアは保存せず、読み込み時に再計算する。
 *  - 読み込んだデータは信用しない：サイズ・型・範囲・バージョンを検証し、判断は normalizeDecisions で範囲内に直す。
 *  - 壊れていても例外で画面全体を止めず、理由を返す。元のデータは勝手に消さない（新しく始めるときに退避する）。
 *  - 個人情報や秘密情報は保存しない。
 */
import { gameConfig as C } from '../config/gameConfig';
import type { DifficultyKey } from '../config/gameConfig';
import { defaultDecisions, normalizeDecisions, replay, sanitizeSeed, simulateTurn } from '../engine';
import type { Decisions, PredictionRecord } from '../engine';
import { gradePrediction, questionBank, questionIdFor } from '../learning';
import { PHASES } from './session';
import type { Phase, Session } from './session';

export const MAX_SAVE_BYTES = 200_000;

export interface SaveDataV2 {
  app: 'yaoya-pl';
  version: 2;
  savedAt: string;
  seed: string;
  difficulty: DifficultyKey;
  turns: { decisions: Decisions; prediction: { qid: string; choice: string } | null }[];
  phase: Phase;
  draft: Decisions;
  choice: string | null;
  seenStages: number[];
  quizAnswers: number[];
  undone: { turn: number; decisions: Decisions } | null;
}

export function toSaveData(s: Session, now = new Date()): SaveDataV2 {
  return {
    app: 'yaoya-pl', version: 2, savedAt: now.toISOString(),
    seed: s.core.seed, difficulty: s.core.difficulty,
    turns: s.core.history.map(h => ({ decisions: h.decisions, prediction: h.prediction ? { qid: h.prediction.qid, choice: h.prediction.choice } : null })),
    phase: s.phase, draft: s.draft, choice: s.choice, seenStages: s.seenStages,
    quizAnswers: s.quizAnswers.filter((x): x is number => x !== null), undone: s.undone
  };
}

export type ParseResult = { ok: true; session: Session; notices: string[] } | { ok: false; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** 文字列のセーブデータを検証して、セッションに復元する */
export function parseSave(text: string): ParseResult {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, reason: 'データが空です' };
  if (text.length > MAX_SAVE_BYTES) return { ok: false, reason: 'データが大きすぎます' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: 'JSONとして読めません' }; }
  if (!isObj(raw)) return { ok: false, reason: '形式が違います' };
  if (raw.app !== 'yaoya-pl') return { ok: false, reason: 'このゲームのセーブデータではありません' };
  if (raw.version !== C.saveVersion) return { ok: false, reason: `対応していないバージョンです（${String(raw.version)}）` };
  if (typeof raw.difficulty !== 'string' || !(raw.difficulty in C.difficulties)) return { ok: false, reason: '難易度が不正です' };
  const difficulty = raw.difficulty as DifficultyKey;
  const seed = sanitizeSeed(raw.seed);
  if (!seed || seed !== raw.seed) return { ok: false, reason: 'シードが不正です' };
  if (!Array.isArray(raw.turns) || raw.turns.length > C.totalTurns) return { ok: false, reason: 'ターンの記録が不正です' };
  const turns: { decisions: unknown; prediction: { qid: string; choice: string } | null }[] = [];
  for (const t of raw.turns) {
    if (!isObj(t) || !isObj(t.decisions)) return { ok: false, reason: 'ターンの判断が不正です' };
    let pred: { qid: string; choice: string } | null = null;
    if (t.prediction !== null && t.prediction !== undefined) {
      const p = t.prediction;
      if (!isObj(p) || typeof p.qid !== 'string' || typeof p.choice !== 'string' || !(p.qid in questionBank)) return { ok: false, reason: '予想の記録が不正です' };
      if (!questionBank[p.qid].options.some(o => o.key === p.choice)) return { ok: false, reason: '予想の選択肢が不正です' };
      pred = { qid: p.qid, choice: p.choice };
    }
    turns.push({ decisions: t.decisions, prediction: pred });
  }
  const notices: string[] = [];

  // 判断の履歴からシードで再計算（スコアや結果はセーブから読まない）
  const rebuilt = replay(difficulty, seed, turns.map(t => ({ decisions: t.decisions, prediction: null })));
  let core = rebuilt.state;
  if (rebuilt.stoppedAt !== null) notices.push(`${rebuilt.stoppedAt + 1}期目で資金ショートになる記録があったため、その前から再開します。`);
  // 予想の正誤も再計算
  core = {
    ...core,
    history: core.history.map((h, i) => {
      const p = turns[i].prediction;
      if (!p) return h;
      const expected = questionIdFor(i, i > 0);
      const prev = i > 0 ? core.history[i - 1].result : null;
      const rec: PredictionRecord | null = p.qid === expected ? gradePrediction(p.qid, p.choice, h.result, prev) : null;
      return { ...h, prediction: rec };
    })
  };

  const n = core.history.length;
  let phase: Phase = typeof raw.phase === 'string' && (PHASES as string[]).includes(raw.phase) ? raw.phase as Phase : 'decide';
  if ((phase === 'quiz' || phase === 'finished') && n < C.totalTurns) phase = 'decide';
  if (phase === 'result' && n === 0) phase = 'decide';
  if ((phase === 'decide' || phase === 'predict' || phase === 'shortage') && n >= C.totalTurns) phase = 'result';
  if (rebuilt.stoppedAt !== null) phase = 'decide';

  const draft = isObj(raw.draft) ? normalizeDecisions(core, raw.draft) : defaultDecisions(core);
  const choice = typeof raw.choice === 'string' && questionBank[questionIdFor(core.turn, n > 0)]?.options.some(o => o.key === raw.choice) ? raw.choice : null;
  if (phase === 'predict' && n >= C.totalTurns) phase = 'result';
  const seenStages = Array.isArray(raw.seenStages) ? [...new Set(raw.seenStages.filter((x): x is number => isInt(x, 0, 4)))] : [];
  let quizAnswers = Array.isArray(raw.quizAnswers) ? raw.quizAnswers.filter((x): x is number => isInt(x, 0, 2)).slice(0, 5) : [];
  if (phase !== 'quiz' && phase !== 'finished') quizAnswers = [];
  if (phase === 'finished' && quizAnswers.length < 5) phase = 'quiz';
  let undone: Session['undone'] = null;
  if (C.difficulties[difficulty].undo && isObj(raw.undone) && isInt(raw.undone.turn, 0, C.totalTurns - 1) && isObj(raw.undone.decisions) && raw.undone.turn <= n) {
    undone = { turn: raw.undone.turn, decisions: normalizeDecisions(core, raw.undone.decisions) };
  }
  let pending = null;
  if (phase === 'shortage') {
    const r = simulateTurn(core, draft);
    if (r.shortage) pending = r; else phase = 'decide';
  }
  return { ok: true, session: { core, phase, draft, choice, seenStages, quizAnswers, undone, pending }, notices };
}

// ---------- localStorage（使えない環境でも例外を外に出さない） ----------
export type LoadResult = { status: 'empty' } | { status: 'ok'; session: Session; notices: string[] } | { status: 'invalid'; reason: string };

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
export function loadFromStorage(): LoadResult {
  const st = storage();
  let text: string | null = null;
  try { text = st ? st.getItem(C.saveKey) : null; } catch { return { status: 'empty' }; }
  if (text === null) return { status: 'empty' };
  const r = parseSave(text);
  return r.ok ? { status: 'ok', session: r.session, notices: r.notices } : { status: 'invalid', reason: r.reason };
}
export function saveToStorage(s: Session): boolean {
  const st = storage();
  if (!st) return false;
  try { st.setItem(C.saveKey, JSON.stringify(toSaveData(s))); return true; } catch { return false; }
}
/** 読み込めなかったデータを消さずに別名で退避する（新しく始めるとき） */
export function backupInvalidSave(): boolean {
  const st = storage();
  if (!st) return false;
  try {
    const text = st.getItem(C.saveKey);
    if (text !== null) st.setItem(C.saveBackupKey, text);
    return true;
  } catch { return false; }
}
/** ユーザーが明示的に選んだときだけ呼ぶ */
export function deleteSave(): void {
  const st = storage();
  try { st?.removeItem(C.saveKey); } catch { /* 何もしない */ }
}
