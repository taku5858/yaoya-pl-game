import { gameConfig as C } from '../config/gameConfig';

/** 金額表示（単位は「万円・小数1桁」に統一。マイナスは「−」記号） */
export function man(yen: number, opts: { plus?: boolean; noUnit?: boolean } = {}): string {
  const v = Math.abs(yen) / 10000;
  const parts = v.toFixed(1).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = yen < 0 ? '−' : opts.plus ? (yen > 0 ? '+' : '±') : '';
  return sign + parts.join('.') + (opts.noUnit ? '' : '万円');
}
/** 個数表示 */
export function qty(n: number, opts: { plus?: boolean } = {}): string {
  const sign = n < 0 ? '−' : opts.plus && n > 0 ? '+' : '';
  return sign + Math.abs(n).toLocaleString('ja-JP') + '個';
}
export function pct(r: number, digits = 1): string {
  const v = Math.abs(r * 100).toFixed(digits);
  return (r < 0 ? '−' : '') + v + '%';
}
export function yen(n: number): string {
  return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP') + '円';
}
export function turnLabel(t: number): string {
  const s = C.seasons[t % 4];
  return `${Math.floor(t / 4) + 1}年目 ${s.name}（${s.months}）`;
}
/** 学習ステージ 0:売上・原価・粗利 1:販管費・営業利益 2:粗利率・固定費・変動費 3:損益分岐点 4:総合判断 */
export function stageOf(turn: number): number {
  return Math.max(0, Math.min(4, Math.floor(turn / 4)));
}
