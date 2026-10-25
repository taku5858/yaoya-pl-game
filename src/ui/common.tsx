/* 画面で共通に使う部品（金額表示・用語ボタン・PL表・流れ図・推移グラフ・ステッパー） */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { gameConfig as C } from '../config/gameConfig';
import type { DifficultyKey } from '../config/gameConfig';
import type { TurnResult } from '../engine';
import { man, plLines, qty, stageOf, termById, turnLabel } from '../learning';

export interface UiContextValue {
  difficulty: DifficultyKey;
  turn: number;               // 用語の解放判定に使うターン
  openTerm: (id: string) => void;
}
export const UiContext = createContext<UiContextValue>({ difficulty: 'easy', turn: 0, openTerm: () => {} });
export const useUi = () => useContext(UiContext);

/** 金額（万円・小数1桁）。マイナスは「−」記号と赤字 */
export function M({ v, plus }: { v: number; plus?: boolean }) {
  return <span className={'num' + (v < 0 ? ' neg' : '')}>{man(v, { plus })}</span>;
}
export function Q({ v }: { v: number }) {
  return <span className="num">{qty(v)}</span>;
}

/** 用語ボタン：押すと一言説明と今回の数字の例を表示。未解放の用語はふつうの文字 */
export function Term({ id, children, turn }: { id: string; children: ReactNode; turn?: number }) {
  const ui = useUi();
  const g = termById(id);
  const st = stageOf(Math.min(turn ?? ui.turn, C.totalTurns - 1));
  if (!g || g.stage > st || (g.hardOnly && ui.difficulty !== 'hard')) return <>{children}</>;
  return <button type="button" className="term" onClick={() => ui.openTerm(id)}>{children}</button>;
}

export function DeltaCell({ delta, kind }: { delta: number | null; kind: 'income' | 'cost' | 'profit' }) {
  if (delta === null) return <td className="muted">—</td>;
  const good = kind === 'cost' ? delta < 0 : delta > 0;
  return <td className={'delta ' + (delta === 0 ? '' : good ? 'good' : 'bad')}>{man(delta, { plus: true })}</td>;
}

/** PL表（当期・前期・増減） */
export function PlTable({ r, p, curLabel = '当期', prevLabel = '前期', noPrev }: { r: TurnResult; p: TurnResult | null; curLabel?: string; prevLabel?: string; noPrev?: boolean }) {
  const { difficulty } = useUi();
  const lines = plLines(difficulty, r.turn);
  return (
    <div className="table-wrap">
      <table className="pl-table">
        <thead><tr><th>項目</th><th>{curLabel}</th>{!noPrev && <><th>{prevLabel}</th><th>増減</th></>}</tr></thead>
        <tbody>
          {lines.map(l => {
            const cur = r.pl[l.key];
            const prv = p ? p.pl[l.key] : null;
            return (
              <tr key={l.key} className={`lv${l.level}${l.strong ? ' strong' : ''}`}>
                <th>
                  <span className="op">{l.op ?? ''}</span>
                  {l.term ? <Term id={l.term} turn={r.turn}>{l.label}</Term> : l.label}
                  {l.note && <small className="line-note">（{l.note}）</small>}
                </th>
                <td><M v={cur} /></td>
                {!noPrev && <>
                  <td>{prv === null ? <span className="muted">—</span> : <M v={prv} />}</td>
                  <DeltaCell delta={prv === null ? null : cur - prv} kind={l.kind} />
                </>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 「売上 → 粗利 → 営業利益」の流れ図 */
export function FlowDiagram({ r }: { r: TurnResult }) {
  const pl = r.pl;
  const sgaName = stageOf(r.turn) >= 1 ? '販管費' : '経費';
  const scale = Math.max(pl.revenue, pl.cogs + pl.sga, 1);
  const w = (v: number) => `${Math.max(0, (v / scale) * 100).toFixed(2)}%`;
  const cogsW = Math.min(pl.cogs, pl.revenue);
  const gp = Math.max(0, pl.grossProfit);
  const op = pl.operatingProfit;
  const loss = op < 0 ? -op : 0;
  const Seg = ({ cls, width, label, value }: { cls: string; width: string; label: string; value: number }) =>
    <div className={'seg ' + cls} style={{ width }} title={`${label} ${man(value)}`}><span>{label}</span></div>;
  return (
    <div className="flow" role="img" aria-label={`売上高${man(pl.revenue)}、売上原価${man(pl.cogs)}、粗利${man(pl.grossProfit)}、${sgaName}${man(pl.sga)}、営業利益${man(op)}`}>
      <div className="flow-row"><div className="flow-lbl">売上高</div><div className="flow-bar"><Seg cls="rev" width={w(pl.revenue)} label="売上高" value={pl.revenue} /></div></div>
      <div className="flow-row"><div className="flow-lbl">粗利</div><div className="flow-bar"><Seg cls="cogs" width={w(cogsW)} label="売上原価" value={pl.cogs} /><Seg cls="gp" width={w(gp)} label="粗利" value={pl.grossProfit} /></div></div>
      <div className="flow-row"><div className="flow-lbl">営業利益</div><div className="flow-bar">
        <div className="seg spacer" style={{ width: w(cogsW) }} />
        <Seg cls="sga" width={w(Math.min(pl.sga, gp))} label={sgaName} value={pl.sga} />
        {op >= 0 ? <Seg cls="op" width={w(op)} label="営業利益" value={op} /> : <Seg cls="loss" width={w(loss)} label="赤字" value={op} />}
      </div></div>
      <ul className="flow-legend">
        <li><i className="sw rev" />売上高 <M v={pl.revenue} /></li>
        <li><i className="sw cogs" />売上原価 <M v={pl.cogs} /></li>
        <li><i className="sw gp" />粗利 <M v={pl.grossProfit} /></li>
        <li><i className="sw sga" />{sgaName} <M v={pl.sga} /></li>
        <li><i className={'sw ' + (op >= 0 ? 'op' : 'loss')} />営業利益 <M v={op} /></li>
      </ul>
      {op < 0 && <p className="flow-note neg-note">▲ {sgaName}が粗利を {man(loss)} 上回り、営業利益は {man(op)}（赤字）です。</p>}
    </div>
  );
}

/** 営業利益の推移（棒グラフ） */
export function OpChart({ results, height = 150 }: { results: TurnResult[]; height?: number }) {
  if (!results.length) return null;
  const W = 600, H = height, pad = 26;
  const vals = results.map(r => r.pl.operatingProfit);
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0);
  const span = Math.max(max - min, 1);
  const zeroY = pad + (max / span) * (H - pad * 2);
  const bw = (W - pad * 2) / C.totalTurns;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="四半期ごとの営業利益の推移">
      {[1, 2, 3, 4].map(y => <line key={y} x1={pad + y * 4 * bw} x2={pad + y * 4 * bw} y1={pad / 2} y2={H - pad / 2} className="grid" />)}
      <line x1={pad} x2={W - pad} y1={zeroY} y2={zeroY} className="zero" />
      {results.map((r, i) => {
        const v = r.pl.operatingProfit;
        const h = (Math.abs(v) / span) * (H - pad * 2);
        return <rect key={i} x={pad + i * bw + bw * 0.15} y={v >= 0 ? zeroY - h : zeroY} width={bw * 0.7} height={Math.max(1, h)} className={v >= 0 ? 'bar-pos' : 'bar-neg'}><title>{`${turnLabel(r.turn)}：${man(v)}`}</title></rect>;
      })}
      {[0, 1, 2, 3, 4].map(y => <text key={y} x={pad + y * 4 * bw + 2 * bw} y={H - 4} className="axis" textAnchor="middle">{y + 1}年目</text>)}
      <text x={pad} y={12} className="axis">{man(max)}</text>
      {min < 0 && <text x={pad} y={H - pad + 12} className="axis neg">{man(min)}</text>}
    </svg>
  );
}

/** −／＋ボタンつきの数値入力 */
export function Stepper({ value, onStep, label, small }: { value: string; onStep: (dir: -1 | 1) => void; label: string; small?: boolean }) {
  return (
    <div className={'stepper' + (small ? ' small' : '')}>
      <button type="button" onClick={() => onStep(-1)} aria-label={`${label}を減らす`}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onStep(1)} aria-label={`${label}を増やす`}>＋</button>
    </div>
  );
}
