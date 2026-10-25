import { gameConfig } from '../config/gameConfig';

/**
 * 金額の端数処理（全項目共通）。千円単位に四捨五入する（負の数は絶対値で四捨五入）。
 * 計算途中の金額はすべてこの関数を通すので、万円・小数1桁で表示しても合計がずれない。
 */
export function money(x: number): number {
  const u = gameConfig.moneyUnit;
  const s = x < 0 ? -1 : 1;
  return s * Math.round(Math.abs(x) / u) * u;
}

export function isMoneyUnit(x: number): boolean {
  return Number.isInteger(x) && x % gameConfig.moneyUnit === 0;
}
