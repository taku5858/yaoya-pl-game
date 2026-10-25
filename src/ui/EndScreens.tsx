/* 理解度テストと最終評価 */
import { gameConfig as C } from '../config/gameConfig';
import { evaluate, man, pct, qty } from '../learning';
import { quizView } from '../save/session';
import type { Session } from '../save/session';
import { M, OpChart } from './common';

/** reviewed：解説を読み終えた問題数。回答数より少ないときは、直前の問題の答え合わせを表示する */
export function QuizScreen({ session, reviewed, onAnswer, onNext }: { session: Session; reviewed: number; onAnswer: (i: number) => void; onNext: () => void }) {
  const { questions } = quizView(session);
  const answered = session.quizAnswers.length;
  const reviewing = answered > reviewed;
  const qi = reviewing ? answered - 1 : Math.min(answered, questions.length - 1);
  const q = questions[qi];
  const ans = reviewing ? session.quizAnswers[qi] : null;
  return (
    <section className="card quiz narrow">
      <h2>📝 理解度テスト <small>{qi + 1} / {questions.length}</small></h2>
      <p className="question">{q.text}</p>
      <div className="choices vertical">
        {q.options.map((o, i) => {
          const cls = ans === null ? '' : i === q.answer ? ' correct' : i === ans ? ' wrong' : '';
          return <button key={i} type="button" className={'choice' + cls} disabled={ans !== null} onClick={() => onAnswer(i)}>{o}</button>;
        })}
      </div>
      {ans !== null && (
        <>
          <div className={'pred ' + (ans === q.answer ? 'ok' : 'ng')}><b>{ans === q.answer ? '⭕ 正解！' : '❌ 不正解'}</b><p>{q.explain}</p></div>
          <div className="actions"><button type="button" className="btn primary big" onClick={onNext}>{qi + 1 < questions.length ? '次の問題へ →' : '成績を見る →'}</button></div>
        </>
      )}
    </section>
  );
}

export function FinishedScreen({ session, onReplay, onTitle }: { session: Session; onReplay: () => void; onTitle: () => void }) {
  const core = session.core;
  const { questions, correct } = quizView(session);
  const ev = evaluate(core, correct, questions.map(q => q.tag));
  const b = ev.business, u = ev.understanding;
  const d = C.difficulties[core.difficulty];
  const hard = core.difficulty === 'hard';
  const achieved = b.cumOP >= b.target;
  const cashGrade = b.minCash >= 0 && b.loan === 0 ? '◎ 借入を完済し、資金ショートもなし' : b.minCash >= 0 ? `○ 資金ショートなし（借入残高 ${man(b.loan)}）` : '△ 資金が苦しい期がありました';
  return (
    <>
      <section className="card end-hero">
        <div className="hero-veg" aria-hidden="true">🍅 🥬 🥕</div>
        <h1>5年間、おつかれさまでした！</h1>
        <p>{achieved ? `目標の ${man(b.target)} を達成しました。` : `目標の ${man(b.target)} には届きませんでしたが、PLのしくみを${u.score >= 50 ? 'しっかり' : '少しずつ'}つかめています。`}</p>
      </section>
      <div className="eval-grid">
        <section className="card eval">
          <h2>① 経営成績</h2>
          <div className={'grade g-' + b.grade}>{b.grade}</div>
          <p className="big-num">累計営業利益 <M v={b.cumOP} /></p>
          <div className="progress big"><i style={{ width: `${Math.max(0, Math.min(100, b.rate * 100)).toFixed(1)}%` }} /></div>
          <p className="center">目標 {man(b.target)} の <b>{pct(b.rate, 0)}</b></p>
          <dl className="kv">
            <dt>5年間の売上高</dt><dd><M v={b.revenue} /></dd>
            <dt>廃棄</dt><dd>{qty(b.wasteQty)}（原価 {man(b.wasteCost)}・売上原価の {pct(b.wasteRate)}）</dd>
            <dt>売り逃し（欠品＋人手不足）</dt><dd>{qty(b.lostQty)}（需要の {pct(b.lostRate)}・機会損失 約{man(b.opportunityLoss)}）</dd>
            <dt>赤字だった期</dt><dd>{b.redTurns}期</dd>
            <dt>最終の手元資金</dt><dd><M v={b.cash} /></dd>
            {hard && <>
              <dt>累計経常利益</dt><dd><M v={b.cumOrdinary} /></dd>
              <dt>借入残高</dt><dd><M v={b.loan} /></dd>
              <dt>最も少なかった手元資金</dt><dd><M v={b.minCash} /></dd>
              <dt>資金繰り</dt><dd>{cashGrade}</dd>
            </>}
            {b.fridgeBook > 0 && <><dt>設備の残りの価値</dt><dd>{man(b.fridgeBook)}（累計営業利益には含めていません）</dd></>}
          </dl>
        </section>
        <section className="card eval">
          <h2>② PL理解度</h2>
          <div className={'grade g-' + u.grade}>{u.grade}</div>
          <p className="big-num">{u.score} <small>/ 100点</small></p>
          <dl className="kv">
            <dt>途中の予想問題</dt><dd>{u.predCorrect} / {u.predTotal} 問 正解（50点満点）</dd>
            <dt>最後の理解度テスト</dt><dd>{u.quizCorrect} / 5 問 正解（50点満点）</dd>
          </dl>
          {u.strong.length > 0 && <><h3>理解できていること</h3><p className="chips good">{u.strong.map(x => <i key={x}>{x}</i>)}</p></>}
          {u.weak.length > 0 && <><h3>復習するとよいこと</h3><p className="chips weak">{u.weak.map(x => <i key={x}>{x}</i>)}</p><p className="small muted">用語集（📖）で、一言説明と例を見直せます。</p></>}
          <p className="small muted">経営成績と理解度は別々に評価しています。利益目標に届かなくても、理解度は高く評価されます。</p>
        </section>
      </div>
      <section className="card"><h2>営業利益の推移</h2><OpChart results={core.history.map(h => h.result)} height={170} /></section>
      <section className="card"><h2>あなたの判断がPLをどう変えたか</h2>
        <ul className="review">{ev.review.map((x, i) => <li key={i}><b>{x.title}</b><p>{x.text}</p></li>)}</ul>
      </section>
      <section className="card center">
        <p>シード「{core.seed}」・{d.emoji}{d.name}</p>
        <div className="actions wrap center">
          <button type="button" className="btn primary" onClick={onReplay}>同じ条件でもう一度</button>
          <button type="button" className="btn" onClick={onTitle}>難易度を選んで新しく始める</button>
        </div>
      </section>
    </>
  );
}
