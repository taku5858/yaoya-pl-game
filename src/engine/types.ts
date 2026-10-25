import type { DifficultyKey, ProductId } from '../config/gameConfig';

export type { DifficultyKey, ProductId };
export type PerProduct<T> = Record<ProductId, T>;

/** プレイヤーの判断（1四半期分） */
export interface Decisions {
  prices: PerProduct<number>;   // 販売価格（円/個）
  orders: PerProduct<number>;   // 1週間あたりの仕入れ数量（個）。13週同じ数を毎週仕入れる
  staff: number;
  ad: number;                   // 広告費（円/四半期）
  buyFridge: boolean;
  borrow: number;
  repay: number;
}

/** 在庫のロット（同じ週に入荷したかたまり）。金額は原価 */
export interface Lot {
  qty: number;
  value: number;        // 原価（円・千円単位）
  weeksLeft: number;    // あと何週売れるか
}

export interface GameEvent {
  type: 'wageRise' | 'costSpike' | 'competitor' | 'boom';
  start: number;
  end: number;
  announce: number;
  product?: ProductId;
  mult?: number;
  wage?: number;
}

export interface TurnEnv {
  turn: number;
  year: number;
  quarter: number;
  season: number;
  wage: number;
  products: PerProduct<{ demandBase: number; cost: number; seasonDemandMult: number; eventDemandMult: number; eventCostMult: number }>;
  events: GameEvent[];
  upcoming: GameEvent[];
}

/** 需要の誤差（判断に依存しない。シードとターンだけで決まる） */
export interface NoiseSet {
  quarter: PerProduct<number>;
  weeks: PerProduct<number>[];
}

export interface WeekRow {
  demand: number;
  sold: number;
  stockout: number;
  capacityLost: number;
  waste: number;
  endQty: number;
}

export interface ProductResult {
  id: ProductId;
  name: string;
  emoji: string;
  price: number;
  unitCost: number;
  expDemand: number;          // 予測需要（誤差なし・四半期）
  demand: number;             // 実際の需要（四半期）
  beginQty: number;
  beginValue: number;
  orderPerWeek: number;
  purchaseQty: number;
  purchaseCost: number;
  availQty: number;           // 期首在庫＋仕入れ（四半期で売れる可能性があった数）
  sold: number;
  stockout: number;           // 在庫切れで売れなかった数
  capacityLost: number;       // 人手不足で売れなかった数
  waste: number;              // 売れる期間を過ぎて廃棄した数
  carry: number;              // 期末在庫（次期へ持ち越し）
  soldCost: number;           // 販売分の原価
  wasteCost: number;          // 廃棄原価
  endValue: number;           // 期末在庫の金額
  revenue: number;
  cogs: number;
  grossProfit: number;
  lostQty: number;
  opportunityLoss: number;    // 参考値（PLには入れない）
  shelfWeeks: number;
  weeks: WeekRow[];
}

export interface PL {
  revenue: number;
  cogsSold: number;
  cogsWaste: number;
  cogs: number;
  grossProfit: number;
  labor: number;
  rent: number;
  utilities: number;
  advertising: number;
  depreciation: number;
  sga: number;
  operatingProfit: number;
  interest: number;
  ordinaryProfit: number;
}

export interface CashFlow {
  begin: number;
  end: number;
  change: number;
  revenueIn: number;
  purchasesOut: number;
  expensesOut: number;      // 人件費・家賃・水道光熱費・広告費（減価償却費は含まない）
  interestOut: number;
  capexOut: number;
  borrow: number;
  repay: number;
  min: number;              // 期中でいちばん少なかった手元資金
  minWhen: string;
}

export interface TurnResult {
  turn: number;
  year: number;
  quarter: number;
  season: number;
  decisions: Decisions;
  env: TurnEnv;
  rows: ProductResult[];
  capacityPerWeek: number;
  capacity: number;
  totals: { demand: number; sold: number; stockout: number; capacityLost: number; waste: number; carry: number; purchaseQty: number; opportunityLoss: number; availQty: number };
  pl: PL;
  inventory: { begin: number; purchases: number; cogsSold: number; cogsWaste: number; end: number };
  cash: CashFlow;
  loan: { begin: number; end: number };
  fridge: { owned: boolean; boughtNow: boolean; bookBegin: number; bookEnd: number };
  endInventory: PerProduct<Lot[]>;
  shortage: boolean;
}

export interface Snapshot {
  turn: number;
  cash: number;
  loan: number;
  fridge: { owned: boolean; bookValue: number; boughtTurn: number | null };
  inventory: PerProduct<Lot[]>;
  cumOP: number;
  cumOrdinary: number;
  minCash: number;
}

export interface PredictionRecord {
  qid: string;
  choice: string;
  answer: string;
  correct: boolean;
  tag: string;
}

export interface TurnRecord {
  turn: number;
  decisions: Decisions;
  result: TurnResult;
  prediction: PredictionRecord | null;
  before: Snapshot;
}

export interface CoreState extends Snapshot {
  seed: string;
  difficulty: DifficultyKey;
  events: GameEvent[];
  history: TurnRecord[];
}

export interface SimOptions {
  noise?: 'actual' | 'zero' | NoiseSet;
  /** 冷蔵設備がなかった場合の比較用 */
  noFridge?: boolean;
}
