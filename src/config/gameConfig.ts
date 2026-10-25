/*
 * 設定データ — 難易度・目標値・商品・費用などの数値はここだけで調整する。
 * 金額の単位はすべて「円」。目標値はシミュレーション（npm run balance）で調整した仮の値。
 */

export type ProductId = 'tomato' | 'cabbage' | 'carrot';
export type DifficultyKey = 'easy' | 'normal' | 'hard';

export interface ProductConfig {
  id: ProductId;
  name: string;
  emoji: string;
  refPrice: number;          // 標準価格（円/個）
  baseCost: number;          // 標準の仕入れ単価（円/個）
  baseDemand: number;        // 1四半期（13週）の基準需要（個）
  elasticity: number;        // 価格を標準より10%上げると需要が elasticity×10% 減る（直線モデル）
  shelfWeeks: number;        // 入荷してから売れる期間（週）。過ぎたら廃棄
  fridgeBonusWeeks: number;  // 冷蔵設備で延びる週数
  perishLabel: string;
  priceStep: number;
  priceMinRate: number;
  priceMaxRate: number;
  seasonDemand: [number, number, number, number]; // 春・夏・秋・冬
  seasonCost: [number, number, number, number];
}

export interface DifficultyConfig {
  key: DifficultyKey;
  name: string;
  emoji: string;
  target: number;            // 5年間の累計営業利益の目標（仮の値・シミュレーションで調整）
  startCash: number;
  seasonal: boolean;
  quarterNoise: number;      // 需要予測の誤差（四半期全体のずれ、±）
  weekNoise: number;         // 週ごとのばらつき（±）
  features: { ad: boolean; fridge: boolean; loan: boolean; events: boolean; ordinary: boolean };
  hintMode: 'always' | 'optional';
  preview: boolean;          // 予想PL（計算補助）
  undo: boolean;             // 1ターン戻す
  summary: string;
}

export const WEEKS_PER_TURN = 13;

export const gameConfig = {
  saveKey: 'yaoya-pl-save-v2',
  saveBackupKey: 'yaoya-pl-save-v2-backup',
  saveVersion: 2,
  totalTurns: 20,
  turnsPerYear: 4,
  weeksPerTurn: WEEKS_PER_TURN,
  moneyUnit: 1000, // 金額はすべて千円単位に四捨五入（万円・小数1桁で表示しても合計がずれない）

  seasons: [
    { key: 'spring', name: '春', months: '4〜6月', emoji: '🌸' },
    { key: 'summer', name: '夏', months: '7〜9月', emoji: '☀️' },
    { key: 'autumn', name: '秋', months: '10〜12月', emoji: '🍁' },
    { key: 'winter', name: '冬', months: '1〜3月', emoji: '⛄' }
  ],

  products: [
    {
      id: 'tomato', name: 'トマト', emoji: '🍅',
      refPrice: 120, baseCost: 70, baseDemand: 22000, elasticity: 2.2,
      shelfWeeks: 1, fridgeBonusWeeks: 1, perishLabel: 'とても傷みやすい',
      priceStep: 5, priceMinRate: 0.7, priceMaxRate: 1.4,
      seasonDemand: [1.0, 1.3, 0.85, 0.75], seasonCost: [1.0, 0.85, 1.05, 1.2]
    },
    {
      id: 'cabbage', name: 'キャベツ', emoji: '🥬',
      refPrice: 200, baseCost: 120, baseDemand: 12000, elasticity: 2.0,
      shelfWeeks: 2, fridgeBonusWeeks: 1, perishLabel: 'ふつう',
      priceStep: 10, priceMinRate: 0.7, priceMaxRate: 1.4,
      seasonDemand: [1.1, 0.85, 1.0, 1.1], seasonCost: [0.95, 1.15, 1.0, 0.95]
    },
    {
      id: 'carrot', name: 'にんじん', emoji: '🥕',
      refPrice: 80, baseCost: 45, baseDemand: 28000, elasticity: 2.5,
      shelfWeeks: 4, fridgeBonusWeeks: 2, perishLabel: '日持ちする',
      priceStep: 5, priceMinRate: 0.7, priceMaxRate: 1.4,
      seasonDemand: [0.95, 0.85, 1.05, 1.15], seasonCost: [1.0, 1.05, 0.95, 1.0]
    }
  ] as ProductConfig[],
  demandFactorMax: 1.8,

  staff: {
    min: 1, max: 10, initial: 5,
    capacityPerWeek: 960,      // 1人が1週間に販売（接客・レジ・品出し）できる個数
    wage: 280000               // 1人あたりの四半期の人件費
  },
  rent: 500000,                // 家賃（四半期）
  utilitiesBase: 150000,       // 水道光熱費（四半期）
  purchase: { step: 10, maxPerWeek: 9990 },

  adOptions: [
    { amount: 0, lift: 0, label: 'なし' },
    { amount: 100000, lift: 0.06, label: '10万円' },
    { amount: 200000, lift: 0.10, label: '20万円' },
    { amount: 400000, lift: 0.14, label: '40万円' }
  ],

  /*
   * 冷蔵設備（むずかしい）の設定根拠 — docs/accounting-rules.md にも記載
   *  price        : 小さな八百屋の業務用冷蔵ショーケース＋工事費を想定して 100万円
   *  lifeQuarters : 耐用年数5年（＝20四半期）。法定耐用年数より短めの簡略化で、ゲーム期間と同じ長さ
   *  減価償却費    : 定額法 100万円 ÷ 20 ＝ 5万円/四半期（残存価額0）
   *  utilitiesExtra: 電気代などの維持費 1万円/四半期
   *  効果          : 売れる期間がトマト・キャベツ +1週、にんじん +2週 延びる（廃棄が減る）
   *  → 1四半期の費用は 6万円。廃棄原価がそれ以上減らないと、営業利益では元が取れない。
   */
  fridge: { price: 1000000, lifeQuarters: 20, utilitiesExtra: 10000 },

  loan: { unit: 1000000, max: 5000000, annualRate: 0.04 },

  events: {
    wageRise: { turn: 8, wage: 300000 },
    costSpike: { turnRange: [4, 11] as [number, number], mult: 1.4 },
    costSpike2: { turnRange: [14, 18] as [number, number], mult: 1.35 },
    competitor: { turnRange: [9, 15] as [number, number], demandMult: 0.8, duration: 2 },
    boom: { turnRange: [2, 17] as [number, number], demandMult: 1.2 }
  },

  difficulties: {
    easy: {
      key: 'easy', name: 'イージー', emoji: '🌱',
      target: 15000000, startCash: 4000000,
      seasonal: false, quarterNoise: 0.02, weekNoise: 0.05,
      features: { ad: false, fridge: false, loan: false, events: false, ordinary: false },
      hintMode: 'always', preview: true, undo: true,
      summary: '需要が安定。価格・仕入れ・人員の3つを決めます。予想PLとヒントつき、1ターン戻してやり直せます。'
    },
    normal: {
      key: 'normal', name: 'ふつう', emoji: '🥕',
      target: 17000000, startCash: 4000000,
      seasonal: true, quarterNoise: 0.08, weekNoise: 0.12,
      features: { ad: true, fridge: false, loan: false, events: false, ordinary: false },
      hintMode: 'optional', preview: false, undo: false,
      summary: '季節で需要と仕入れ値が変わり、週ごとの売れ行きもばらつきます。広告も使えます。需要予測には誤差があります。'
    },
    hard: {
      key: 'hard', name: 'むずかしい', emoji: '🔥',
      target: 15000000, startCash: 1500000,
      seasonal: true, quarterNoise: 0.08, weekNoise: 0.12,
      features: { ad: true, fridge: true, loan: true, events: true, ordinary: true },
      hintMode: 'optional', preview: false, undo: false,
      summary: '仕入れ値の高騰や競合の安売り、人件費の上昇が起きます。冷蔵設備（減価償却）と借入（支払利息）で、経常利益と資金繰りも学びます。'
    }
  } as Record<DifficultyKey, DifficultyConfig>,

  stages: [
    { year: 1, theme: '売上・原価・粗利', lead: 'まずは「売上」から「売れた野菜の原価」を引いた「粗利」をつかみましょう。仕入れた分がすべて原価になるわけではありません。' },
    { year: 2, theme: '販管費・営業利益', lead: '粗利から家賃や人件費などの「販管費」を引いたものが「営業利益」。お店の本業でもうかった金額です。' },
    { year: 3, theme: '粗利率・固定費・変動費', lead: '売上に対する粗利の割合が「粗利率」。費用を「売れた量で変わるもの」と「変わらないもの」に分けて見る、PLとは別の切り口も学びます。' },
    { year: 4, theme: '損益分岐点', lead: '営業利益がちょうど0になる売上が「損益分岐点」。今の売上がそれをどれだけ上回っているかを見ます。' },
    { year: 5, theme: '総合判断', lead: 'これまでの知識を総動員して、利益と資金のバランスを考えた最終年の経営に挑みましょう。' }
  ]
};

export type GameConfig = typeof gameConfig;
export const PRODUCT_IDS: ProductId[] = gameConfig.products.map(p => p.id);
