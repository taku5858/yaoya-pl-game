import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameConfig as C } from '../src/config/gameConfig';
import { backupInvalidSave, loadFromStorage, parseSave, saveToStorage, toSaveData } from '../src/save/saveData';
import { choose, currentQuestionId, nextTurn, runTurn, startSession, toPredict } from '../src/save/session';
import { questionBank } from '../src/learning';
import type { Session } from '../src/save/session';

function playTurns(s: Session, n: number): Session {
  for (let i = 0; i < n; i++) {
    s = toPredict(s);
    s = choose(s, questionBank[currentQuestionId(s)].options[0].key);
    s = runTurn(s);
    s = nextTurn(s);
  }
  return s;
}

describe('セーブデータの保存と復元', () => {
  it('保存して読み込むと、同じ結果が再計算される', () => {
    let s = startSession('hard', 'SAVE1');
    s = playTurns(s, 6);
    const text = JSON.stringify(toSaveData(s));
    const r = parseSave(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.core.turn).toBe(s.core.turn);
    expect(r.session.core.cumOP).toBe(s.core.cumOP);
    expect(r.session.core.cash).toBe(s.core.cash);
    expect(r.session.core.history.map(h => h.prediction?.correct)).toEqual(s.core.history.map(h => h.prediction?.correct));
    expect(r.session.phase).toBe(s.phase);
  });

  it('スコアや資金を書き換えても反映されない（判断から再計算する）', () => {
    let s = startSession('normal', 'SAVE2');
    s = playTurns(s, 3);
    const data = toSaveData(s) as unknown as Record<string, unknown>;
    data.cumOP = 999999999; data.cash = 999999999;
    const r = parseSave(JSON.stringify(data));
    expect(r.ok && r.session.core.cumOP).toBe(s.core.cumOP);
  });

  it('判断の数値が不正でも、範囲内に直して読み込む', () => {
    const s = playTurns(startSession('normal', 'SAVE3'), 2);
    const data = toSaveData(s);
    (data.turns[0].decisions.orders as Record<string, unknown>).tomato = -5000;
    (data.turns[0].decisions as unknown as Record<string, unknown>).staff = 'many';
    (data.draft.prices as Record<string, unknown>).carrot = 1e9;
    const r = parseSave(JSON.stringify(data));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.core.history[0].decisions.orders.tomato).toBe(0);
    expect(r.session.core.history[0].decisions.staff).toBe(C.staff.initial);
    expect(r.session.draft.prices.carrot).toBeLessThanOrEqual(80 * 1.4);
  });

  const bad: [string, string][] = [
    ['空文字', ''],
    ['JSONでない', '{not json'],
    ['配列', '[]'],
    ['別アプリ', JSON.stringify({ app: 'other', version: 2 })],
    ['古いバージョン', JSON.stringify({ app: 'yaoya-pl', version: 1 })],
    ['不明な難易度', JSON.stringify({ app: 'yaoya-pl', version: 2, difficulty: 'expert', seed: 'A', turns: [] })],
    ['シードに記号', JSON.stringify({ app: 'yaoya-pl', version: 2, difficulty: 'easy', seed: '<script>', turns: [] })],
    ['ターンが多すぎる', JSON.stringify({ app: 'yaoya-pl', version: 2, difficulty: 'easy', seed: 'A', turns: Array(21).fill({ decisions: {} }) })],
    ['予想が不正', JSON.stringify({ app: 'yaoya-pl', version: 2, difficulty: 'easy', seed: 'A', turns: [{ decisions: {}, prediction: { qid: 'hack', choice: 'x' } }] })],
    ['大きすぎる', 'x'.repeat(300000)]
  ];
  for (const [name, text] of bad) {
    it(`壊れたデータ（${name}）は例外を出さずに不正と判定`, () => {
      expect(() => parseSave(text)).not.toThrow();
      expect(parseSave(text).ok).toBe(false);
    });
  }

  it('進行段階の矛盾（20ターン前なのに終了など）は安全な段階に直す', () => {
    const s = playTurns(startSession('easy', 'SAVE4'), 2);
    const data = { ...toSaveData(s), phase: 'finished' as const, quizAnswers: [0, 1, 2, 0, 1] };
    const r = parseSave(JSON.stringify(data));
    expect(r.ok && r.session.phase).toBe('decide');
    expect(r.ok && r.session.quizAnswers).toEqual([]);
  });
});

describe('localStorage', () => {
  afterEach(() => vi.unstubAllGlobals());
  function fakeStorage() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), map: m };
  }
  it('保存→読み込みができる', () => {
    const st = fakeStorage();
    vi.stubGlobal('localStorage', st);
    const s = playTurns(startSession('easy', 'LS1'), 1);
    expect(saveToStorage(s)).toBe(true);
    const r = loadFromStorage();
    expect(r.status).toBe('ok');
  });
  it('壊れたデータは invalid と判定し、消さずに退避できる', () => {
    const st = fakeStorage();
    st.setItem(C.saveKey, '{broken');
    vi.stubGlobal('localStorage', st);
    expect(loadFromStorage().status).toBe('invalid');
    expect(backupInvalidSave()).toBe(true);
    expect(st.map.get(C.saveBackupKey)).toBe('{broken');
    expect(st.map.get(C.saveKey)).toBe('{broken');
  });
  it('localStorage が使えない環境でも例外を出さない', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('x'); } });
    expect(() => loadFromStorage()).not.toThrow();
    expect(saveToStorage(startSession('easy', 'LS2'))).toBe(false);
  });
  it('保存データに個人情報や結果の金額を含めない', () => {
    const s = playTurns(startSession('hard', 'LS3'), 2);
    const keys = Object.keys(toSaveData(s));
    expect(keys.sort()).toEqual(['app', 'choice', 'difficulty', 'draft', 'phase', 'quizAnswers', 'savedAt', 'seed', 'seenStages', 'turns', 'undone', 'version'].sort());
  });
});

describe('予想の選択', () => {
  it('今の問題の選択肢にない値は受け付けない', () => {
    const s = toPredict(startSession('easy', 'CH'));
    expect(choose(s, 'hack').choice).toBeNull();
    const ok = questionBank[currentQuestionId(s)].options[0].key;
    expect(choose(s, ok).choice).toBe(ok);
  });
});
