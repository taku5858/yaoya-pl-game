/* 経営判断フォーム（本番の判断と「別の判断と比べる」で共通） */
import { useState } from 'react';
import { gameConfig as C, PRODUCT_IDS, WEEKS_PER_TURN } from '../config/gameConfig';
import type { ProductId } from '../config/gameConfig';
import { diffOf, money, normalizeDecisions, outlook, priceRange, productById, shelfWeeks, suggestedOrder } from '../engine';
import type { CoreState, Decisions } from '../engine';
import { man, qty, yen } from '../learning';
import { M, Stepper, Term } from './common';

const productColor: Record<ProductId, string> = { tomato: 'var(--tomato)', cabbage: 'var(--cabbage)', carrot: 'var(--carrot)' };

/** 仕入れ数量の入力（入力中の文字はそのまま保持し、確定時に検証する） */
function OrderInput({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = parseInt(text.replace(/[^\d]/g, ''), 10);
    onCommit(Number.isFinite(v) ? v : 0);
    setText(null);
  };
  return (
    <input
      type="text" inputMode="numeric" aria-label={label}
      value={text ?? String(value)}
      onChange={e => setText(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export function DecisionForm({ state, draft, onChange, compact }: { state: CoreState; draft: Decisions; onChange: (d: Decisions) => void; compact?: boolean }) {
  const d = diffOf(state);
  const o = outlook(state, draft);
  const n = normalizeDecisions(state, draft);
  const set = (f: (x: Decisions) => void) => {
    const next: Decisions = JSON.parse(JSON.stringify(n));
    f(next);
    onChange(normalizeDecisions(state, next));
  };
  const fitOne = (id: ProductId) => set(x => { x.orders[id] = suggestedOrder(state, x, id); });
  const fitAll = () => set(x => { for (const id of PRODUCT_IDS) x.orders[id] = suggestedOrder(state, x, id); });
  const totalBuy = PRODUCT_IDS.reduce((s, id, i) => s + money(n.orders[id] * o.rows[i].cost) * WEEKS_PER_TURN, 0);
  const capOk = o.capacity >= o.totalDemand;

  return (
    <div className="decision-form">
      {!compact && (
        <div className="fit-explain">
          <b>「需要予測に合わせる」ボタンについて</b>
          <p>この価格・広告での<b>予測需要（3か月分）から持ち越し在庫を引き、13週で割った数</b>を「毎週の仕入れ数」に入れます。価格・人員・広告は変わりません。</p>
          <p className="small">需要予測は販売の保証ではありません。実際の販売数は、価格・人員（販売できる上限）・在庫・予測の誤差（週ごとのばらつき）で変わります。</p>
        </div>
      )}
      <div className="decide-grid">
        {PRODUCT_IDS.map((id, i) => {
          const p = productById(id), row = o.rows[i];
          const price = n.prices[id];
          const supply = row.carry + n.orders[id] * WEEKS_PER_TURN;
          const gap = supply - row.demandAtPrice;
          const gapEl = gap < -row.demandAtPrice * 0.05 ? <span className="bad">予測より {qty(-gap)} 少ない</span>
            : gap > row.demandAtPrice * 0.08 ? <span className="warn">予測より {qty(gap)} 多い</span> : <span className="good">予測とほぼ同じ</span>;
          const rg = priceRange(p);
          return (
            <div className="prod-card" key={id} style={{ ['--accent' as string]: productColor[id] }}>
              <div className="prod-head"><span className="emoji" aria-hidden="true">{p.emoji}</span><b>{p.name}</b>
                <span className="tag"><Term id="shelf">売れる期間 {shelfWeeks(id, state.fridge.owned || n.buyFridge)}週</Term></span></div>
              {!compact && <div className="facts">
                <span>仕入れ値 <b>{yen(row.cost)}</b></span>
                <span>持ち越し <b>{qty(row.carry)}</b></span>
                <span><Term id="forecast">予測需要</Term>（この価格） <b>約{qty(row.demandAtPrice)}</b>（週 約{qty(Math.round(row.demandAtPrice / WEEKS_PER_TURN))}）</span>
              </div>}
              <div className="ctrl">
                <span className="ctrl-lbl">販売価格</span>
                <Stepper label={`${p.name}の価格`} value={yen(price)} onStep={dir => set(x => { x.prices[id] = Math.min(rg.max, Math.max(rg.min, price + dir * p.priceStep)); })} />
                <span className="ctrl-sub">1個の粗利 <b className={price - row.cost <= 0 ? 'bad' : ''}>{yen(price - row.cost)}</b>・標準 {yen(p.refPrice)}</span>
              </div>
              <div className="ctrl">
                <span className="ctrl-lbl">毎週の仕入れ</span>
                <div className="stepper wide">
                  <button type="button" onClick={() => set(x => { x.orders[id] = Math.max(0, n.orders[id] - 100); })} aria-label={`${p.name}の仕入れを100個減らす`}>−100</button>
                  <button type="button" onClick={() => set(x => { x.orders[id] = Math.max(0, n.orders[id] - 10); })} aria-label="10個減らす">−10</button>
                  <OrderInput value={n.orders[id]} label={`${p.name}の毎週の仕入れ数量`} onCommit={v => set(x => { x.orders[id] = v; })} />
                  <button type="button" onClick={() => set(x => { x.orders[id] = n.orders[id] + 10; })} aria-label="10個増やす">+10</button>
                  <button type="button" onClick={() => set(x => { x.orders[id] = n.orders[id] + 100; })} aria-label="100個増やす">+100</button>
                </div>
                <span className="ctrl-sub">
                  13週で {qty(n.orders[id] * WEEKS_PER_TURN)}・仕入れ代金 <b>{man(money(n.orders[id] * row.cost) * WEEKS_PER_TURN)}</b>
                  {!compact && <>（持ち越しと合わせ {qty(supply)}：{gapEl}）</>}
                  {' '}<button type="button" className="link" onClick={() => fitOne(id)} title="予測需要−持ち越し在庫を13週で割った数を毎週の仕入れにします">需要予測に合わせる</button>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {!compact && <p className="fitall"><button type="button" className="btn small" onClick={fitAll}>3品目とも需要予測に合わせて仕入れる</button><span className="small muted">（仕入れ数だけを変更）</span></p>}

      <div className="opt-grid">
        <div className="opt-card">
          <div className="opt-head"><b>👥 人員</b><span className="small muted">1人 {man(o.env.wage)}/期・1人が売れるのは週 {qty(C.staff.capacityPerWeek)}まで</span></div>
          <div className="ctrl">
            <Stepper label="人員" value={`${n.staff}人`} onStep={dir => set(x => { x.staff = n.staff + dir; })} />
            <span className="ctrl-sub">人件費 <b>{man(n.staff * o.env.wage)}</b>・販売できる上限 <b>{qty(o.capacity)}</b>（週 {qty(n.staff * C.staff.capacityPerWeek)}）</span>
          </div>
          <div className={'cap-bar' + (capOk ? '' : ' over')}><i style={{ width: `${Math.min(100, (o.totalDemand / Math.max(1, o.capacity)) * 100).toFixed(1)}%` }} /></div>
          <p className={'small ' + (capOk ? 'muted' : 'bad')}>予測需要の合計 約{qty(o.totalDemand)} {capOk ? '→ 人手は足りそう' : `→ 約${qty(o.totalDemand - o.capacity)} 分、人手が足りなさそう`}</p>
        </div>
        {d.features.ad && (
          <div className="opt-card">
            <div className="opt-head"><b>📣 広告費</b><span className="small muted">需要が増えるが、費用もかかる</span></div>
            <div className="seg-btns" role="radiogroup" aria-label="広告費">
              {C.adOptions.map(a => (
                <button key={a.amount} type="button" role="radio" aria-checked={n.ad === a.amount} className={n.ad === a.amount ? 'on' : ''} onClick={() => set(x => { x.ad = a.amount; })}>
                  {a.label}<small>{a.lift ? `需要+${Math.round(a.lift * 100)}%` : '—'}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {(d.features.fridge || d.features.loan) && (
          <div className="opt-card">
            <div className="opt-head"><b>🏗️ 設備とお金</b></div>
            {state.fridge.owned ? (
              <p>🧊 冷蔵設備：<b>導入済み</b>（帳簿上の価値 {man(state.fridge.bookValue)}・毎期の<Term id="depreciation">減価償却費</Term> {man(C.fridge.price / C.fridge.lifeQuarters)}）</p>
            ) : (
              <>
                <label className="check"><input type="checkbox" checked={n.buyFridge} onChange={e => set(x => { x.buyFridge = e.target.checked; })} /> 🧊 冷蔵設備を今期に導入する（{man(C.fridge.price)}）</label>
                <p className="small muted">売れる期間がトマト・キャベツ +1週、にんじん +2週。代金は今期に全額支払い、費用（<Term id="depreciation">減価償却費</Term>）は毎期 {man(C.fridge.price / C.fridge.lifeQuarters)} ずつ{C.fridge.lifeQuarters}期。電気代 +{man(C.fridge.utilitiesExtra)}/期。廃棄が毎期 {man(C.fridge.price / C.fridge.lifeQuarters + C.fridge.utilitiesExtra)} 以上減らないと、営業利益では元が取れません。</p>
              </>
            )}
            {d.features.loan && (
              <div className="loan-row">
                <span>🏦 借入残高 <b>{man(state.loan)}</b>（年利{(C.loan.annualRate * 100).toFixed(0)}%・上限{man(C.loan.max)}）</span>
                <div className="loan-ctrls">
                  <span>借りる</span><Stepper label="借入" value={man(n.borrow)} onStep={dir => set(x => { x.borrow = n.borrow + dir * C.loan.unit; if (x.borrow > 0) x.repay = 0; })} />
                  <span>返す</span><Stepper label="返済" value={man(n.repay)} onStep={dir => set(x => { x.repay = n.repay + dir * C.loan.unit; if (x.repay > 0) x.borrow = 0; })} />
                </div>
                <p className="small muted">借入は売上ではなく、返済は費用ではありません（お金が増減するだけ）。利息だけが費用で、営業利益の下で引かれます。</p>
              </div>
            )}
          </div>
        )}
      </div>
      {!compact && (
        <p className="buy-total">
          13週の仕入れ代金の合計 <b>{man(totalBuy)}</b>（毎週支払い）{n.buyFridge && <>＋設備 {man(C.fridge.price)}（期首）</>}　/　期首の手元資金 <b><M v={state.cash} /></b>{n.borrow > 0 && <>＋借入 {man(n.borrow)}</>}
          <br /><span className="small muted">支払いの時期：家賃・設備・返済は期首、仕入れは毎週、人件費・水道光熱費・広告費・利息は期末。売上は毎週入金。</span>
        </p>
      )}
    </div>
  );
}
