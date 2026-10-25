/*
 * 計算結果の分析（解説文の元になる数字）。ここで出す数字は必ず TurnResult から計算し、PLと一致させる。
 */
import { gameConfig as C } from '../config/gameConfig';
import { money, simulateTurn } from '../engine';
import type { CoreState, TurnResult } from '../engine';

// ---------- 費用の性質（固定費・変動費）と損益分岐点 ----------
export type CostNature = 'variable' | 'fixed' | 'discretionary' | 'waste';
export interface CostItem { key: string; label: string; plGroup: '売上原価' | '販管費'; nature: CostNature; natureLabel: string; note: string; amount: number }

export const natureLabels: Record<CostNature, string> = {
  variable: '変動費',
  fixed: '固定費',
  discretionary: 'プレイヤーが決める費用',
  waste: '仕入れと売れ残りで変わる費用'
};

/**
 * PLの分類（売上原価・販管費）と、費用の性質（固定費・変動費など）は別の切り口。
 * このゲームでの前提を費目ごとに定義する。
 */
export function costItems(r: TurnResult): CostItem[] {
  const items: CostItem[] = [
    { key: 'cogsSold', label: '販売分の仕入原価', plGroup: '売上原価', nature: 'variable', natureLabel: natureLabels.variable, note: '売れた数量に比例して増える', amount: r.pl.cogsSold },
    { key: 'cogsWaste', label: '廃棄原価', plGroup: '売上原価', nature: 'waste', natureLabel: natureLabels.waste, note: '売上には比例しない。仕入れすぎ・売れ残りで増える', amount: r.pl.cogsWaste },
    { key: 'labor', label: '人件費', plGroup: '販管費', nature: 'fixed', natureLabel: natureLabels.fixed, note: '期のはじめに決めた人数分。売上が増減してもその期は変わらない', amount: r.pl.labor },
    { key: 'rent', label: '家賃', plGroup: '販管費', nature: 'fixed', natureLabel: natureLabels.fixed, note: '毎期同じ', amount: r.pl.rent },
    { key: 'utilities', label: '水道光熱費', plGroup: '販管費', nature: 'fixed', natureLabel: natureLabels.fixed, note: 'このゲームでは毎期ほぼ一定とみなす', amount: r.pl.utilities },
    { key: 'advertising', label: '広告費', plGroup: '販管費', nature: 'discretionary', natureLabel: natureLabels.discretionary, note: '売上とは関係なく、あなたが金額を決める', amount: r.pl.advertising }
  ];
  if (r.pl.depreciation) items.push({ key: 'depreciation', label: '減価償却費', plGroup: '販管費', nature: 'fixed', natureLabel: natureLabels.fixed, note: '設備代金を20期に分けた額。毎期同じ', amount: r.pl.depreciation });
  return items;
}

export interface BreakEven {
  revenue: number;
  variable: number;          // 変動費（販売分の仕入原価）
  marginal: number;          // 限界利益＝売上高−変動費
  marginalRate: number;      // 限界利益率
  fixed: number;             // 固定費（人件費・家賃・水道光熱費・減価償却費）
  discretionary: number;     // 広告費
  waste: number;             // 廃棄原価
  burden: number;            // 売上で回収すべき費用＝固定費＋広告費＋廃棄原価
  breakEven: number | null;  // 損益分岐点売上高
  safety: number | null;     // 売上高−損益分岐点
  gpMargin: number;          // 粗利率（PL上の指標。限界利益率とは別物）
}
/**
 * 損益分岐点（初心者向けの近似）：価格・1個あたりの仕入原価の割合・人員・広告費・廃棄額が今期と同じと仮定し、
 *  損益分岐点売上高 ＝（固定費＋広告費＋廃棄原価）÷ 限界利益率
 * このとき 営業利益 ＝（売上高−損益分岐点売上高）× 限界利益率 が成り立つ（端数を除き一致）。
 */
export function breakEven(r: TurnResult): BreakEven {
  const revenue = r.pl.revenue;
  const variable = r.pl.cogsSold;
  const marginal = revenue - variable;
  const marginalRate = revenue > 0 ? marginal / revenue : 0;
  const fixed = r.pl.labor + r.pl.rent + r.pl.utilities + r.pl.depreciation;
  const discretionary = r.pl.advertising;
  const waste = r.pl.cogsWaste;
  const burden = fixed + discretionary + waste;
  const be = marginalRate > 0 ? money(burden / marginalRate) : null;
  return {
    revenue, variable, marginal, marginalRate, fixed, discretionary, waste, burden,
    breakEven: be, safety: be === null ? null : revenue - be,
    gpMargin: revenue > 0 ? r.pl.grossProfit / revenue : 0
  };
}

// ---------- 営業利益の変化の分解（合計は必ず営業利益の差に一致） ----------
export interface Driver { key: string; label: string; delta: number; effect: number; sign: 1 | -1 }
export function opDrivers(r: TurnResult, p: TurnResult): Driver[] {
  const list: [string, string, number, 1 | -1][] = [
    ['revenue', '売上高', r.pl.revenue - p.pl.revenue, 1],
    ['cogsSold', '販売分の原価', r.pl.cogsSold - p.pl.cogsSold, -1],
    ['cogsWaste', '廃棄原価', r.pl.cogsWaste - p.pl.cogsWaste, -1],
    ['labor', '人件費', r.pl.labor - p.pl.labor, -1],
    ['advertising', '広告費', r.pl.advertising - p.pl.advertising, -1],
    ['utilities', '水道光熱費', r.pl.utilities - p.pl.utilities, -1],
    ['rent', '家賃', r.pl.rent - p.pl.rent, -1],
    ['depreciation', '減価償却費', r.pl.depreciation - p.pl.depreciation, -1]
  ];
  return list
    .map(([key, label, delta, sign]) => ({ key, label, delta, sign, effect: sign * delta }))
    .filter(x => x.delta !== 0)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}

// ---------- 利益と資金のつながり ----------
export interface BridgeItem { label: string; value: number }
export function cashBridgeItems(r: TurnResult): BridgeItem[] {
  const items: BridgeItem[] = [{ label: '営業利益', value: r.pl.operatingProfit }];
  if (r.pl.depreciation) items.push({ label: '減価償却費（費用だがお金は出ない）', value: r.pl.depreciation });
  const dInv = r.inventory.end - r.inventory.begin;
  if (dInv) items.push({ label: dInv > 0 ? '在庫の増加（お金が野菜に変わった）' : '在庫の減少（前の期に仕入れた分を売った）', value: -dInv });
  if (r.cash.capexOut) items.push({ label: '設備投資（買った期に全額支払い）', value: -r.cash.capexOut });
  if (r.cash.borrow) items.push({ label: '借入（売上ではない）', value: r.cash.borrow });
  if (r.cash.repay) items.push({ label: '返済（費用ではない）', value: -r.cash.repay });
  if (r.pl.interest) items.push({ label: '支払利息', value: -r.pl.interest });
  return items;
}

// ---------- 冷蔵設備の効果（同じ乱数で「設備がなかったら」と比較） ----------
export interface FridgeEffect {
  wasteWith: number; wasteWithout: number;
  wasteQtyWith: number; wasteQtyWithout: number;
  grossWith: number; grossWithout: number;
  cost: number;            // 減価償却費＋電気代の増加
  opEffect: number;        // 営業利益への効果（設備あり−なし）
}
export function fridgeEffect(before: CoreState, r: TurnResult): FridgeEffect | null {
  if (!r.fridge.owned) return null;
  const without = simulateTurn(before, r.decisions, { noFridge: true });
  return {
    wasteWith: r.pl.cogsWaste, wasteWithout: without.pl.cogsWaste,
    wasteQtyWith: r.totals.waste, wasteQtyWithout: without.totals.waste,
    grossWith: r.pl.grossProfit, grossWithout: without.pl.grossProfit,
    cost: r.pl.depreciation + C.fridge.utilitiesExtra,
    opEffect: r.pl.operatingProfit - without.pl.operatingProfit
  };
}
