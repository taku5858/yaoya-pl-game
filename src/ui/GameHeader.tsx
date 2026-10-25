import { gameConfig as C } from '../config/gameConfig';
import { man } from '../learning';
import type { Session } from '../save/session';
import { M, Term } from './common';

export function viewTurn(s: Session): number {
  if (s.phase === 'result' || s.phase === 'quiz' || s.phase === 'finished') return Math.max(0, s.core.turn - 1);
  return Math.min(s.core.turn, C.totalTurns - 1);
}

export function GameHeader({ session, onGlossary, onMenu }: { session: Session; onGlossary: () => void; onMenu: () => void }) {
  const t = viewTurn(session);
  const s = C.seasons[t % 4];
  const d = C.difficulties[session.core.difficulty];
  const rate = Math.max(0, Math.min(1, session.core.cumOP / d.target));
  const names = ['状況を見る', '経営判断', '結果を予想', '経営結果', '理由を学ぶ', '次の期へ'];
  const active: Record<string, number[]> = { decide: [0, 1], predict: [2], result: [3, 4, 5], shortage: [3] };
  const on = active[session.phase] ?? [];
  return (
    <>
      <header className="topbar">
        <div className="brand"><span aria-hidden="true">🥬</span> やおやPL商店 <small>{d.emoji}{d.name}</small></div>
        <div className="when"><b>{Math.floor(t / 4) + 1}年目 {s.emoji}{s.name}</b><span>{s.months}・第{t + 1}期 / {C.totalTurns}</span></div>
        <nav className="top-actions">
          <button type="button" onClick={onGlossary} aria-label="用語集"><span aria-hidden="true">📖</span><span className="lbl">用語集</span></button>
          <button type="button" onClick={onMenu} aria-label="メニュー"><span aria-hidden="true">☰</span><span className="lbl">メニュー</span></button>
        </nav>
      </header>
      <div className="status">
        <div className="stat goal">
          <span className="lbl"><Term id="operatingProfit">累計営業利益</Term>（本業のもうけ）/ 目標</span>
          <span className="val"><M v={session.core.cumOP} /> <small>/ {man(d.target)}</small></span>
          <div className="progress" role="progressbar" aria-valuenow={Math.round(rate * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${(rate * 100).toFixed(1)}%` }} /></div>
        </div>
        <div className="stat"><span className="lbl"><Term id="cash">手元資金</Term></span><span className="val"><M v={session.core.cash} /></span></div>
        {d.features.loan && <div className="stat"><span className="lbl">借入残高</span><span className="val"><M v={session.core.loan} /></span></div>}
        {d.features.ordinary && <div className="stat"><span className="lbl">累計経常利益</span><span className="val"><M v={session.core.cumOrdinary} /></span></div>}
      </div>
      {on.length > 0 && (
        <ol className="steps" aria-label="ターンの流れ">
          {names.map((n, i) => <li key={n} className={(on.includes(i) ? 'on' : '') + (i < on[0] ? ' done' : '')}><span>{'①②③④⑤⑥'[i]}</span>{n}</li>)}
        </ol>
      )}
    </>
  );
}
