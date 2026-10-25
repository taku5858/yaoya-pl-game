/* ①状況 ②判断 ③予想、資金ショート */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { gameConfig as C, PRODUCT_IDS } from '../config/gameConfig';
import { diffOf, getTurnEnv, normalizeDecisions, outlook, productById, shelfWeeks, simulateTurn } from '../engine';
import type { CoreState, Decisions, GameEvent } from '../engine';
import { explainTurn, hintsFor, man, pct, qty, questionBank, shortageReasons, stageIntro, stageOf, turnLabel, yen } from '../learning';
import { currentQuestionId, lastResult } from '../save/session';
import type { Session } from '../save/session';
import { FlowDiagram, M, OpChart, PlTable } from './common';
import { DecisionForm } from './DecisionForm';

function eventText(ev: GameEvent, upcoming = false): ReactNode {
  const p = ev.product ? productById(ev.product) : null;
  if (ev.type === 'wageRise') return upcoming ? <>📢 <b>予告</b>：来期から人件費が1人あたり {man(ev.wage ?? 0)}（四半期）に上がります。</> : <>💼 人件費は1人あたり {man(ev.wage ?? 0)}（四半期）。</>;
  if (!p || !ev.mult) return null;
  if (ev.type === 'costSpike') return <>⚠️ <b>{p.emoji}{p.name}の仕入れ値が高騰</b>（今期だけ +{Math.round((ev.mult - 1) * 100)}%）</>;
  if (ev.type === 'competitor') return <>🏬 <b>近くのスーパーが{p.emoji}{p.name}を安売り</b>（{ev.end > ev.start ? '2期続く・' : ''}同じ価格だと需要 −{Math.round((1 - ev.mult) * 100)}%）</>;
  return <>📺 <b>{p.emoji}{p.name}がテレビで話題</b>（今期だけ需要 +{Math.round((ev.mult - 1) * 100)}%）</>;
}

function Situation({ state, draft }: { state: CoreState; draft: Decisions }) {
  const o = outlook(state, draft);
  const d = diffOf(state);
  const prevEnv = state.turn > 0 ? getTurnEnv(state, state.turn - 1) : null;
  const s = C.seasons[o.env.season];
  const evs = [...o.env.events.map(e => eventText(e)), ...o.env.upcoming.map(e => eventText(e, true))].filter(Boolean);
  return (
    <section className="card situation">
      <h2><span className="num-badge">①</span>今期の状況</h2>
      <div className="season-row">
        <span className={`season-badge s-${s.key}`}>{s.emoji} {s.name}（{s.months}）</span>
        <span className="small muted">{d.seasonal ? '季節によって需要と仕入れ値が変わります' : 'イージーでは需要と仕入れ値は一定です'}。予測の誤差は期全体で ±{Math.round(d.quarterNoise * 100)}%、週ごとのばらつきは ±{Math.round(d.weekNoise * 100)}% 程度。</span>
      </div>
      {evs.length > 0 && <ul className="events">{evs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <div className="table-wrap"><table className="sit-table">
        <thead><tr><th>商品</th><th>仕入れ値</th><th>予測需要<small>（標準価格・3か月）</small></th><th>持ち越し在庫</th><th>売れる期間</th></tr></thead>
        <tbody>{o.rows.map(r => {
          const p = productById(r.id);
          const pc = prevEnv ? prevEnv.products[r.id].cost : null;
          return (
            <tr key={r.id}>
              <th>{p.emoji} {p.name}</th>
              <td>{yen(r.cost)} {pc !== null && pc !== r.cost && <small className={r.cost > pc ? 'bad' : 'good'}>{r.cost > pc ? '▲' : '▼'}前期{pc}円</small>}</td>
              <td>約{qty(r.demandAtRef)}<small>（{yen(p.refPrice)}）</small></td>
              <td>{qty(r.carry)}{r.carry > 0 && <small>（{man(r.carryValue)}）</small>}</td>
              <td>{shelfWeeks(r.id, state.fridge.owned)}週<small>（{p.perishLabel}）</small></td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}

export function PreviewBox({ state, draft }: { state: CoreState; draft: Decisions }) {
  const r = simulateTurn(state, draft, { noise: 'zero' });
  const sgaName = stageOf(state.turn) >= 1 ? '販管費' : '経費';
  return (
    <div className="preview">
      <h3>🧮 予想PL（予測どおりの需要が来た場合）</h3>
      <dl>
        <dt>売上高</dt><dd><M v={r.pl.revenue} /></dd>
        <dt>− 売上原価</dt><dd><M v={r.pl.cogs} /></dd>
        <dt>＝ 粗利</dt><dd><M v={r.pl.grossProfit} /></dd>
        <dt>− {sgaName}</dt><dd><M v={r.pl.sga} /></dd>
        <dt className="strong">＝ 営業利益</dt><dd className="strong"><M v={r.pl.operatingProfit} /></dd>
        <dt>期末の手元資金</dt><dd><M v={r.cash.end} /></dd>
      </dl>
      <p className="small muted">計算の補助です。実際の需要は予測からずれるので、結果は変わります。</p>
    </div>
  );
}

function SidePanel({ session }: { session: Session }) {
  const h = session.core.history;
  const r = lastResult(session);
  if (!r) {
    return (
      <section className="card side-pl"><h2>PLのしくみ</h2>
        <p>まだ結果はありません。最初の判断をしましょう。結果が出ると、ここに前期のPLと前々期との比較が表示されます。</p>
        <div className="pl-mini vertical"><div>売上高</div><div className="op">−</div><div>売上原価<small>（売れた分＋捨てた分の原価）</small></div><div className="op">＝</div><div className="hl">粗利</div><div className="op">−</div><div>経費<small>（家賃・人件費など）</small></div><div className="op">＝</div><div className="hl">営業利益<small>お店の本業でもうかった金額</small></div></div>
      </section>
    );
  }
  const p = h.length > 1 ? h[h.length - 2].result : null;
  const ex = explainTurn(session.core, h.length - 1);
  return (
    <>
      <section className="card side-pl">
        <h2>前期のPL <small>{turnLabel(r.turn)}</small></h2>
        <PlTable r={r} p={p} curLabel="前期" prevLabel="前々期" />
        <FlowDiagram r={r} />
      </section>
      <section className="card"><h2>前期の結果のポイント</h2><ul className="points">{ex.points.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}</ul></section>
      {h.length > 1 && <section className="card"><h2>営業利益の推移</h2><OpChart results={h.map(x => x.result)} height={130} /></section>}
    </>
  );
}

export function DecideScreen({ session, onDraft, onIntroOk, onPredict, onUndo }: {
  session: Session; onDraft: (d: Decisions) => void; onIntroOk: () => void; onPredict: () => void; onUndo: () => void;
}) {
  const [showHints, setShowHints] = useState(false);
  const core = session.core;
  const d = diffOf(core);
  const st = stageOf(core.turn);
  const intro = core.turn % 4 === 0 && !session.seenStages.includes(st) ? stageIntro(core.difficulty, st) : null;
  const hints = hintsFor(core, session.draft, outlook(core, session.draft));
  const hintsOpen = d.hintMode === 'always' || showHints;
  return (
    <>
      {intro && (
        <section className="card intro">
          <div className="intro-badge">{intro.title}</div>
          <p>{intro.lead}</p>
          {intro.extra.map((x, i) => <p className="small" key={i}>{x}</p>)}
          <button type="button" className="btn primary small" onClick={onIntroOk}>わかった</button>
        </section>
      )}
      <div className="layout">
        <div className="col-main">
          <Situation state={core} draft={session.draft} />
          <section className="card decide">
            <h2><span className="num-badge">②</span>経営判断</h2>
            <DecisionForm state={core} draft={session.draft} onChange={onDraft} />
            {hintsOpen ? (
              <div className="hints">
                <h3>💡 ヒント {d.hintMode !== 'always' && <button type="button" className="link" onClick={() => setShowHints(false)}>閉じる</button>}</h3>
                {hints.length ? <ul>{hints.map((h, i) => <li key={i}>{h}</li>)}</ul> : <p className="small">大きな問題は見当たりません。価格を少し変えると販売数と1個の粗利がどう変わるか、試してみましょう。</p>}
              </div>
            ) : <p><button type="button" className="btn small ghost" onClick={() => setShowHints(true)}>💡 ヒントを見る</button></p>}
            {d.preview && <PreviewBox state={core} draft={session.draft} />}
          </section>
        </div>
        <aside className="col-side"><SidePanel session={session} /></aside>
      </div>
      <div className="actionbar">
        {d.undo && core.history.length > 0 && <button type="button" className="btn ghost" onClick={onUndo}>↩ 1つ前の期に戻る</button>}
        <button type="button" className="btn primary big" onClick={onPredict}>判断を決定して、結果を予想する →</button>
      </div>
    </>
  );
}

export function PredictScreen({ session, onChoose, onBack, onRun }: { session: Session; onChoose: (k: string) => void; onBack: () => void; onRun: () => void }) {
  const core = session.core;
  const q = questionBank[currentQuestionId(session)];
  const p = lastResult(session);
  const n = normalizeDecisions(core, session.draft);
  const d = diffOf(core);
  const st = stageOf(core.turn);
  return (
    <section className="card predict narrow">
      <h2><span className="num-badge">③</span>結果を予想しよう</h2>
      <p className="question">{q.text}</p>
      <div className="choices" role="radiogroup">
        {q.options.map(o => <button key={o.key} type="button" role="radio" aria-checked={session.choice === o.key} className={'choice' + (session.choice === o.key ? ' on' : '')} onClick={() => onChoose(o.key)}>{o.label}</button>)}
      </div>
      {p && <p className="small muted">参考：前期は 売上高 {man(p.pl.revenue)}／粗利 {man(p.pl.grossProfit)}／{st >= 1 ? '販管費' : '経費'} {man(p.pl.sga)}／営業利益 {man(p.pl.operatingProfit)}{st >= 2 && p.pl.revenue > 0 ? `／粗利率 ${pct(p.pl.grossProfit / p.pl.revenue)}` : ''}</p>}
      {d.preview && <PreviewBox state={core} draft={session.draft} />}
      <details className="mydec"><summary>今回の判断を確認</summary>
        <ul>
          {PRODUCT_IDS.map(id => { const pr = productById(id); return <li key={id}>{pr.emoji}{pr.name}：{yen(n.prices[id])}・毎週 {qty(n.orders[id])} 仕入れ</li>; })}
          <li>👥 人員 {n.staff}人{d.features.ad && `・📣 広告 ${man(n.ad)}`}{n.buyFridge && '・🧊 冷蔵設備を導入'}{n.borrow > 0 && `・借入 ${man(n.borrow)}`}{n.repay > 0 && `・返済 ${man(n.repay)}`}</li>
        </ul>
      </details>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onBack}>← 判断を直す</button>
        <button type="button" className="btn primary big" onClick={onRun} disabled={!session.choice}>{session.choice ? '結果を見る →' : '予想を選んでください'}</button>
      </div>
    </section>
  );
}

export function ShortageScreen({ session, onRetry, onRetryPrev, onRestart }: { session: Session; onRetry: () => void; onRetryPrev: () => void; onRestart: () => void }) {
  const r = session.pending;
  if (!r) return null;
  return (
    <section className="card shortage narrow">
      <h2>💸 資金ショート！</h2>
      <p>この判断のままだと、期の途中で手元資金が <b><M v={r.cash.min} /></b> まで減り、仕入れ先や従業員への支払いができなくなります。</p>
      <h3>原因</h3>
      <ul className="points">{shortageReasons(r, core(session).difficulty === 'hard').map((x, i) => <li key={i}>{x}</li>)}</ul>
      <PlTable r={r} p={lastResult(session)} curLabel="この判断" />
      <div className="actions wrap">
        <button type="button" className="btn primary" onClick={onRetry}>この期の判断をやり直す</button>
        {session.core.history.length > 0 && <button type="button" className="btn" onClick={onRetryPrev}>1つ前の期からやり直す</button>}
        <button type="button" className="btn ghost" onClick={onRestart}>最初からやり直す</button>
      </div>
    </section>
  );
}
const core = (s: Session) => s.core;
