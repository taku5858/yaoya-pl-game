/* ④経営結果 ⑤理由を学ぶ ⑥次の期へ */
import { useState } from 'react';
import { gameConfig as C } from '../config/gameConfig';
import { diffOf, simulateTurn, stateBefore } from '../engine';
import type { Decisions, TurnResult } from '../engine';
import {
  breakEven, cashBridgeItems, compareText, costItems, explainTurn, man, opDrivers, pct, predictionView, qty, stageOf, turnLabel, yen
} from '../learning';
import type { Driver } from '../learning';
import type { Session } from '../save/session';
import { DeltaCell, FlowDiagram, M, PlTable, Term } from './common';
import { DecisionForm } from './DecisionForm';

function Drivers({ ds, dOP }: { ds: Driver[]; dOP: number }) {
  const maxAbs = Math.max(1, ...ds.map(x => Math.abs(x.effect)), Math.abs(dOP));
  const Bar = ({ label, eff, delta, total }: { label: string; eff: number; delta?: number; total?: boolean }) => (
    <div className={'drv' + (total ? ' total' : '')}>
      <span className="drv-lbl">{label}{delta !== undefined && <small>{man(delta, { plus: true })}</small>}</span>
      <span className="drv-track"><i className={eff >= 0 ? 'pos' : 'neg'} style={{ width: `${((Math.abs(eff) / maxAbs) * 50).toFixed(1)}%` }} /></span>
      <span className={'drv-val ' + (eff >= 0 ? 'good' : 'bad')}>{man(eff, { plus: true })}</span>
    </div>
  );
  return (
    <div className="drivers">
      <p className="small muted">各項目が営業利益をいくら動かしたか（左＝減らした、右＝増やした）。下の合計は営業利益の増減と一致します。</p>
      {ds.map(x => <Bar key={x.key} label={x.label} eff={x.effect} delta={x.delta} />)}
      <Bar label="営業利益の変化" eff={dOP} total />
    </div>
  );
}

function SalesTable({ r }: { r: TurnResult }) {
  return (
    <>
      <div className="table-wrap"><table className="sales-table">
        <thead><tr><th>商品</th><th>価格</th><th>需要</th><th>仕入れ＋持ち越し</th><th>販売数</th><th><Term id="opportunity" turn={r.turn}>欠品</Term></th><th>人手不足</th><th><Term id="waste" turn={r.turn}>廃棄</Term></th><th><Term id="inventory" turn={r.turn}>持ち越し</Term></th></tr></thead>
        <tbody>
          {r.rows.map(x => (
            <tr key={x.id}><th>{x.emoji} {x.name}</th><td>{yen(x.price)}</td><td>{qty(x.demand)}<small>予測{qty(x.expDemand)}</small></td><td>{qty(x.availQty)}</td><td><b>{qty(x.sold)}</b></td>
              <td className={x.stockout ? 'bad' : ''}>{qty(x.stockout)}</td><td className={x.capacityLost ? 'bad' : ''}>{qty(x.capacityLost)}</td><td className={x.waste ? 'warn' : ''}>{qty(x.waste)}</td><td>{qty(x.carry)}</td></tr>
          ))}
          <tr className="total"><th>合計</th><td /><td>{qty(r.totals.demand)}</td><td>{qty(r.totals.availQty)}</td><td><b>{qty(r.totals.sold)}</b></td><td>{qty(r.totals.stockout)}</td><td>{qty(r.totals.capacityLost)}</td><td>{qty(r.totals.waste)}</td><td>{qty(r.totals.carry)}</td></tr>
        </tbody>
      </table></div>
      <p className="small muted">需要＝販売数＋欠品＋人手不足。販売できる上限は週 {qty(r.capacityPerWeek)}（{r.decisions.staff}人）。売り逃しの機会損失は約 {man(r.totals.opportunityLoss)}（参考値。PLの費用には入りません）。</p>
      <details className="weekly">
        <summary>週ごとの動きを見る（13週）</summary>
        <div className="table-wrap"><table className="week-table">
          <thead><tr><th>週</th>{r.rows.map(x => <th key={x.id} colSpan={3}>{x.emoji}{x.name}<small>需要/販売/廃棄</small></th>)}</tr></thead>
          <tbody>{r.rows[0].weeks.map((_, w) => (
            <tr key={w}><th>{w + 1}</th>{r.rows.map(x => { const k = x.weeks[w]; return [<td key={x.id + 'd'}>{k.demand.toLocaleString()}</td>, <td key={x.id + 's'} className={k.sold < k.demand ? 'bad' : ''}>{k.sold.toLocaleString()}</td>, <td key={x.id + 'w'} className={k.waste ? 'warn' : ''}>{k.waste.toLocaleString()}</td>]; })}</tr>
          ))}</tbody>
        </table></div>
        <p className="small muted">毎週同じ数を仕入れても、需要は週ごとにばらつきます。多く来た週は欠品、少ない週は売れ残り、売れる期間を過ぎた分が廃棄になります。</p>
      </details>
    </>
  );
}

function InventoryBox({ r, text }: { r: TurnResult; text: string }) {
  const i = r.inventory;
  return (
    <>
      <div className="inv-eq">
        <div className="box">期首在庫<b><M v={i.begin} /></b></div><div className="sym">＋</div>
        <div className="box">当期仕入<b><M v={i.purchases} /></b></div><div className="sym">＝</div>
        <div className="box cost">販売分の原価<b><M v={i.cogsSold} /></b></div><div className="sym">＋</div>
        <div className="box cost">廃棄原価<b><M v={i.cogsWaste} /></b></div><div className="sym">＋</div>
        <div className="box asset">期末在庫<b><M v={i.end} /></b></div>
      </div>
      <p className="inv-legend"><span className="sw cost" />売上原価（今期の費用 {man(r.pl.cogs)}）　<span className="sw asset" />在庫（まだ売れる期間がある分・次期へ）</p>
      <p className="small">{text}</p>
    </>
  );
}

function CashBox({ r, text }: { r: TurnResult; text: string }) {
  const items = cashBridgeItems(r);
  return (
    <>
      <table className="bridge"><tbody>
        {items.map((x, i) => <tr key={i}><th>{i === 0 ? '' : x.value >= 0 ? '＋' : '−'} {x.label}</th><td>{i === 0 ? <M v={x.value} /> : <span className="num">{man(Math.abs(x.value))}</span>}</td></tr>)}
        <tr className="total"><th>＝ 手元資金の増減</th><td><M v={r.cash.change} /></td></tr>
        <tr className="muted-row"><th>手元資金 期首 → 期末</th><td>{man(r.cash.begin)} → <M v={r.cash.end} /></td></tr>
        <tr className="muted-row"><th>期中でいちばん少なかった時</th><td><M v={r.cash.min} /></td></tr>
      </tbody></table>
      <p className="small">{text}</p>
    </>
  );
}

/** 費用の2つの見方（PLの区分と、固定費・変動費の区分）＋損益分岐点 */
function CostView({ r }: { r: TurnResult }) {
  const st = stageOf(r.turn);
  const items = costItems(r);
  const b = breakEven(r);
  return (
    <section className="card">
      <h2><Term id="costView" turn={r.turn}>費用の2つの見方</Term></h2>
      <p className="small">PLは費用を「売上原価」と「販管費」に分けます。それとは別の切り口として、費用が売れた量で変わるかどうかで見ることができます。下の分類は<b>このゲームでの前提</b>です。</p>
      <div className="table-wrap"><table className="cost-table">
        <thead><tr><th>費目</th><th>PLの区分</th><th>費用の性質</th><th>今期の金額</th></tr></thead>
        <tbody>{items.map(x => <tr key={x.key}><th>{x.label}<small className="block">{x.note}</small></th><td>{x.plGroup}</td><td className={'nature-' + x.nature}>{x.natureLabel}</td><td><M v={x.amount} /></td></tr>)}</tbody>
      </table></div>
      <div className="analysis">
        <div><Term id="gpMargin" turn={r.turn}>粗利率</Term> <b>{pct(b.gpMargin)}</b><small>（粗利÷売上高・廃棄を含む）</small></div>
        <div><Term id="variableCost" turn={r.turn}>変動費</Term> <b><M v={b.variable} /></b></div>
        <div><Term id="fixedCost" turn={r.turn}>固定費</Term> <b><M v={b.fixed} /></b></div>
      </div>
      {st >= 3 && (
        <div className="bep">
          <h3><Term id="breakEven" turn={r.turn}>損益分岐点</Term>（初心者向けの近似）</h3>
          <p className="formula">（固定費 {man(b.fixed)} ＋ 広告費 {man(b.discretionary)} ＋ 廃棄原価 {man(b.waste)}）÷ <Term id="marginal" turn={r.turn}>限界利益率</Term> {pct(b.marginalRate)} ≒ <b>{b.breakEven === null ? '計算不可' : man(b.breakEven)}</b></p>
          {b.breakEven !== null && <p>今期の売上高 {man(r.pl.revenue)} は、損益分岐点を <b><M v={b.safety ?? 0} plus /></b> {(b.safety ?? 0) >= 0 ? '上回っています' : '下回っています'}。（売上高−損益分岐点）× 限界利益率 ≒ 営業利益 {man(r.pl.operatingProfit)}。</p>}
          <p className="small muted">前提：価格・1個あたりの仕入原価の割合・人員・広告費・廃棄額が今期と同じとした近似です。広告費と廃棄原価は売上に比例しないため、固定費と同じ「売上で回収すべき費用」側に入れています。</p>
        </div>
      )}
    </section>
  );
}

function CompareTable({ a, b, la, lb, ordinary }: { a: TurnResult; b: TurnResult; la: string; lb: string; ordinary: boolean }) {
  const rows: [string, keyof TurnResult['pl'], 'income' | 'cost' | 'profit'][] = [
    ['売上高', 'revenue', 'income'], ['売上原価', 'cogs', 'cost'], ['うち廃棄原価', 'cogsWaste', 'cost'], ['粗利', 'grossProfit', 'profit'],
    [stageOf(a.turn) >= 1 ? '販管費' : '経費', 'sga', 'cost'], ['営業利益', 'operatingProfit', 'profit']
  ];
  if (ordinary) rows.push(['経常利益', 'ordinaryProfit', 'profit']);
  const lostA = a.totals.stockout + a.totals.capacityLost, lostB = b.totals.stockout + b.totals.capacityLost;
  return (
    <div className="table-wrap"><table className="pl-table cmp">
      <thead><tr><th /><th>{la}</th><th>{lb}</th><th>差</th></tr></thead>
      <tbody>
        {rows.map(([lbl, k, kind]) => <tr key={k} className={kind === 'profit' ? 'strong' : ''}><th>{lbl}</th><td><M v={a.pl[k]} /></td><td><M v={b.pl[k]} /></td><DeltaCell delta={b.pl[k] - a.pl[k]} kind={kind} /></tr>)}
        <tr><th>販売数</th><td>{qty(a.totals.sold)}</td><td>{qty(b.totals.sold)}</td><td>{qty(b.totals.sold - a.totals.sold, { plus: true })}</td></tr>
        <tr><th>廃棄</th><td>{qty(a.totals.waste)}</td><td>{qty(b.totals.waste)}</td><td>{qty(b.totals.waste - a.totals.waste, { plus: true })}</td></tr>
        <tr><th>売り逃し</th><td>{qty(lostA)}</td><td>{qty(lostB)}</td><td>{qty(lostB - lostA, { plus: true })}</td></tr>
        <tr><th>期末の手元資金</th><td><M v={a.cash.end} /></td><td><M v={b.cash.end} /></td><DeltaCell delta={b.cash.end - a.cash.end} kind="income" /></tr>
      </tbody>
    </table></div>
  );
}

export function ResultScreen({ session, onNext, onUndo }: { session: Session; onNext: () => void; onUndo: () => void }) {
  const core = session.core;
  const idx = core.history.length - 1;
  const rec = core.history[idx];
  const r = rec.result;
  const p = idx > 0 ? core.history[idx - 1].result : null;
  const ex = explainTurn(core, idx);
  const d = diffOf(core);
  const st = stageOf(r.turn);
  const isLast = core.turn >= C.totalTurns;
  const before = stateBefore(core, idx);
  const pred = rec.prediction ? predictionView(rec.prediction, r, p) : null;
  const [cmpDraft, setCmpDraft] = useState<Decisions | null>(null);
  const [cmpResult, setCmpResult] = useState<TurnResult | null>(null);
  const undone = session.undone && session.undone.turn === r.turn ? simulateTurn(before, session.undone.decisions) : null;
  const dOP = p ? r.pl.operatingProfit - p.pl.operatingProfit : 0;

  return (
    <>
      <section className="card result-head">
        <h2><span className="num-badge">④</span>経営結果 <small>{turnLabel(r.turn)}</small></h2>
        <div className="kpis">
          <div className="kpi"><span>売上高</span><b><M v={r.pl.revenue} /></b>{p && <small>{man(r.pl.revenue - p.pl.revenue, { plus: true })}</small>}</div>
          <div className="kpi"><span>粗利</span><b><M v={r.pl.grossProfit} /></b>{p && <small>{man(r.pl.grossProfit - p.pl.grossProfit, { plus: true })}</small>}</div>
          <div className={'kpi main' + (r.pl.operatingProfit < 0 ? ' neg' : '')}><span>営業利益（本業のもうけ）</span><b><M v={r.pl.operatingProfit} /></b>{p && <small>{man(dOP, { plus: true })}</small>}</div>
          {d.features.ordinary && <div className="kpi"><span>経常利益</span><b><M v={r.pl.ordinaryProfit} /></b></div>}
          <div className="kpi"><span>手元資金</span><b><M v={r.cash.end} /></b><small>{man(r.cash.change, { plus: true })}</small></div>
        </div>
        {pred && rec.prediction && (
          <div className={'pred ' + (rec.prediction.correct ? 'ok' : 'ng')}>
            <b>{rec.prediction.correct ? '⭕ 予想的中！' : '❌ 予想ははずれ'}</b>
            <span>「{pred.text}」→ あなたの予想：{pred.choiceLabel} ／ 結果：{pred.answerLabel}</span>
            <p>{pred.explain}</p>
          </div>
        )}
      </section>

      <section className="card">
        <h2><span className="num-badge">⑤</span>なぜ利益が変わったか</h2>
        <p className="summary">{ex.summary}</p>
        {p && <Drivers ds={opDrivers(r, p)} dOP={dOP} />}
        {ex.notes.length > 0 && <><h3>今回の気づき</h3><ul className="points">{ex.notes.slice(0, 6).map((n, i) => <li key={i}>{n.text}</li>)}</ul></>}
      </section>

      <div className="layout result-layout">
        <div className="col-main">
          <section className="card"><h2>PL（損益計算書）</h2>
            <PlTable r={r} p={p} />
            <FlowDiagram r={r} />
            <p className="small muted">税金などは省略しています（実際のPLでは、このあと法人税等を引いて当期純利益を出します）。</p>
          </section>
          <section className="card"><h2>販売の結果</h2><SalesTable r={r} /></section>
        </div>
        <div className="col-side">
          <section className="card"><h2>仕入れと売上原価（在庫のつながり）</h2><InventoryBox r={r} text={ex.inventory} /></section>
          <section className="card"><h2>利益と手元資金のちがい</h2><CashBox r={r} text={ex.cash} /></section>
          {ex.fridge && (
            <section className="card fridge-card"><h2>🧊 冷蔵設備の効果（今期）</h2>
              <table className="bridge"><tbody>
                <tr><th>廃棄原価（設備なし → あり）</th><td>{man(ex.fridge.wasteWithout)} → {man(ex.fridge.wasteWith)}</td></tr>
                <tr><th>粗利の増加</th><td><M v={ex.fridge.grossWith - ex.fridge.grossWithout} plus /></td></tr>
                <tr><th>− 設備の費用（減価償却費＋電気代）</th><td><span className="num">{man(ex.fridge.cost)}</span></td></tr>
                <tr className="total"><th>＝ 営業利益への効果</th><td><M v={ex.fridge.opEffect} plus /></td></tr>
              </tbody></table>
              <p className="small muted">同じ需要（同じ乱数）で、設備がなかった場合を計算して比べています。廃棄がもともと少ないと、設備の費用を回収できません。</p>
            </section>
          )}
        </div>
      </div>
      {st >= 2 && <CostView r={r} />}

      {undone && (
        <section className="card compare-card"><h2>やり直し前との比較</h2>
          <CompareTable a={undone} b={r} la="やり直し前" lb="今回" ordinary={d.features.ordinary} />
          <p>{compareText(undone, r)}</p>
        </section>
      )}

      <details className="card compare-card" open={!!cmpDraft} onToggle={e => { if ((e.target as HTMLDetailsElement).open && !cmpDraft) setCmpDraft(JSON.parse(JSON.stringify(rec.decisions))); }}>
        <summary><h2>🔁 別の判断と比べる <small>同じ需要・同じ乱数で計算します</small></h2></summary>
        {cmpDraft ? (
          <>
            <DecisionForm state={before} draft={cmpDraft} onChange={x => { setCmpDraft(x); setCmpResult(null); }} compact />
            <p className="actions wrap">
              <button type="button" className="btn primary" onClick={() => setCmpResult(simulateTurn(before, cmpDraft))}>この判断で計算する</button>
              <button type="button" className="btn ghost small" onClick={() => { setCmpDraft(JSON.parse(JSON.stringify(rec.decisions))); setCmpResult(null); }}>実際の判断に戻す</button>
            </p>
            {cmpResult && <>
              <CompareTable a={r} b={cmpResult} la="実際" lb="別の判断" ordinary={d.features.ordinary} />
              <p className="summary">{compareText(r, cmpResult)}</p>
              {cmpResult.shortage && <p className="bad small">※この判断では期中に資金ショートしていました（最低 {man(cmpResult.cash.min)}）。</p>}
            </>}
          </>
        ) : <p className="small muted">開くと、今回の判断をもとに価格や数量を変えて比べられます。</p>}
      </details>

      <div className="actionbar">
        {d.undo && <button type="button" className="btn ghost" onClick={onUndo}>↩ 1ターン戻してやり直す</button>}
        <button type="button" className="btn primary big" onClick={onNext}>{isLast ? '5年間の経営を終えて、理解度テストへ →' : '⑥ 次の期へ進む →'}</button>
      </div>
    </>
  );
}
