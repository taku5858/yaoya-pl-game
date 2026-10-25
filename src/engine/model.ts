import { gameConfig as C, PRODUCT_IDS, WEEKS_PER_TURN } from '../config/gameConfig';
import type { DifficultyConfig, DifficultyKey, ProductConfig, ProductId } from '../config/gameConfig';
import { rngFor } from './rng';
import type { CoreState, Decisions, GameEvent, Lot, NoiseSet, PerProduct, TurnEnv } from './types';

export function diffOf(state: { difficulty: DifficultyKey }): DifficultyConfig {
  return C.difficulties[state.difficulty];
}
export function productById(id: ProductId): ProductConfig {
  const p = C.products.find(x => x.id === id);
  if (!p) throw new Error('unknown product ' + id);
  return p;
}
export function perProduct<T>(f: (id: ProductId) => T): PerProduct<T> {
  return Object.fromEntries(PRODUCT_IDS.map(id => [id, f(id)])) as PerProduct<T>;
}

// ---------- できごと（むずかしい） ----------
export function generateEvents(seed: string, difficulty: DifficultyKey): GameEvent[] {
  if (!C.difficulties[difficulty].features.events) return [];
  const E = C.events;
  const r = rngFor(seed, 'events');
  const pickTurn = (range: [number, number]) => range[0] + Math.floor(r() * (range[1] - range[0] + 1));
  const pickProduct = (exclude?: ProductId) => {
    const pool = PRODUCT_IDS.filter(id => id !== exclude);
    return pool[Math.floor(r() * pool.length)];
  };
  const events: GameEvent[] = [];
  events.push({ type: 'wageRise', start: E.wageRise.turn, end: C.totalTurns - 1, wage: E.wageRise.wage, announce: E.wageRise.turn - 1 });
  const s1 = pickTurn(E.costSpike.turnRange), p1 = pickProduct();
  events.push({ type: 'costSpike', start: s1, end: s1, product: p1, mult: E.costSpike.mult, announce: s1 });
  const s2 = pickTurn(E.costSpike2.turnRange), p2 = pickProduct(p1);
  events.push({ type: 'costSpike', start: s2, end: s2, product: p2, mult: E.costSpike2.mult, announce: s2 });
  const s3 = pickTurn(E.competitor.turnRange), p3 = pickProduct();
  events.push({ type: 'competitor', start: s3, end: s3 + E.competitor.duration - 1, product: p3, mult: E.competitor.demandMult, announce: s3 });
  const s4 = pickTurn(E.boom.turnRange), p4 = pickProduct(p3);
  events.push({ type: 'boom', start: s4, end: s4, product: p4, mult: E.boom.demandMult, announce: s4 });
  return events;
}

// ---------- そのターンの環境 ----------
export function getTurnEnv(state: Pick<CoreState, 'difficulty' | 'events'>, t: number): TurnEnv {
  const d = diffOf(state);
  const season = t % 4;
  const products = perProduct(id => {
    const p = productById(id);
    return {
      demandBase: p.baseDemand * (d.seasonal ? p.seasonDemand[season] : 1),
      costRaw: p.baseCost * (d.seasonal ? p.seasonCost[season] : 1),
      seasonDemandMult: d.seasonal ? p.seasonDemand[season] : 1,
      eventDemandMult: 1, eventCostMult: 1
    };
  });
  const env: TurnEnv = { turn: t, season, year: Math.floor(t / 4) + 1, quarter: (t % 4) + 1, wage: C.staff.wage, products: {} as TurnEnv['products'], events: [], upcoming: [] };
  for (const ev of state.events) {
    const active = t >= ev.start && t <= ev.end;
    if (active) {
      env.events.push(ev);
      if (ev.type === 'wageRise' && ev.wage) env.wage = ev.wage;
      if (ev.type === 'costSpike' && ev.product && ev.mult) { products[ev.product].costRaw *= ev.mult; products[ev.product].eventCostMult *= ev.mult; }
      if ((ev.type === 'competitor' || ev.type === 'boom') && ev.product && ev.mult) { products[ev.product].demandBase *= ev.mult; products[ev.product].eventDemandMult *= ev.mult; }
    } else if (ev.announce < ev.start && t >= ev.announce && t < ev.start) {
      env.upcoming.push(ev);
    }
  }
  env.products = perProduct(id => {
    const x = products[id];
    return { demandBase: x.demandBase, cost: Math.round(x.costRaw), seasonDemandMult: x.seasonDemandMult, eventDemandMult: x.eventDemandMult, eventCostMult: x.eventCostMult };
  });
  return env;
}

export function adLift(amount: number): number {
  return C.adOptions.find(o => o.amount === amount)?.lift ?? 0;
}
export function priceFactor(p: ProductConfig, price: number): number {
  const x = price / p.refPrice;
  return Math.min(C.demandFactorMax, Math.max(0, 1 - p.elasticity * (x - 1)));
}
/** 誤差なしの需要予測（四半期・個） */
export function expectedDemand(env: TurnEnv, id: ProductId, price: number, ad: number): number {
  return env.products[id].demandBase * priceFactor(productById(id), price) * (1 + adLift(ad));
}

/** 需要の誤差：四半期全体のずれ（予測誤差）＋週ごとのばらつき */
export function demandNoise(state: Pick<CoreState, 'seed' | 'difficulty'>, t: number): NoiseSet {
  const d = diffOf(state);
  const r = rngFor(state.seed, 'demand', t);
  const quarter = perProduct(() => (r() * 2 - 1) * d.quarterNoise);
  const weeks: PerProduct<number>[] = [];
  for (let w = 0; w < WEEKS_PER_TURN; w++) weeks.push(perProduct(() => (r() * 2 - 1) * d.weekNoise));
  return { quarter, weeks };
}
export function zeroNoise(): NoiseSet {
  const weeks: PerProduct<number>[] = [];
  for (let w = 0; w < WEEKS_PER_TURN; w++) weeks.push(perProduct(() => 0));
  return { quarter: perProduct(() => 0), weeks };
}

// ---------- 判断の正規化（入力値の検証） ----------
export function priceRange(p: ProductConfig): { min: number; max: number } {
  return {
    min: Math.ceil(p.refPrice * p.priceMinRate / p.priceStep) * p.priceStep,
    max: Math.floor(p.refPrice * p.priceMaxRate / p.priceStep) * p.priceStep
  };
}
const finite = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const roundStep = (v: number, step: number) => Math.round(v / step) * step;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * どんな値が来ても、ゲームで有効な判断に直す。負の仕入れ・NaN・範囲外・使えない機能は無効化する。
 */
export function normalizeDecisions(state: Pick<CoreState, 'difficulty' | 'loan' | 'fridge'>, raw: unknown): Decisions {
  const d = diffOf(state);
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const prices = (src.prices && typeof src.prices === 'object' ? src.prices : {}) as Record<string, unknown>;
  const orders = (src.orders && typeof src.orders === 'object' ? src.orders : {}) as Record<string, unknown>;
  const out: Decisions = {
    prices: perProduct(id => {
      const p = productById(id), rg = priceRange(p);
      return clamp(roundStep(finite(prices[id], p.refPrice), p.priceStep), rg.min, rg.max);
    }),
    orders: perProduct(id => clamp(roundStep(finite(orders[id], 0), C.purchase.step), 0, C.purchase.maxPerWeek)),
    staff: clamp(Math.round(finite(src.staff, C.staff.initial)), C.staff.min, C.staff.max),
    ad: 0, buyFridge: false, borrow: 0, repay: 0
  };
  const ad = finite(src.ad, 0);
  if (d.features.ad && C.adOptions.some(o => o.amount === ad)) out.ad = ad;
  out.buyFridge = d.features.fridge && src.buyFridge === true && !state.fridge.owned;
  if (d.features.loan) {
    const u = C.loan.unit;
    let borrow = clamp(roundStep(finite(src.borrow, 0), u), 0, C.loan.max - state.loan);
    let repay = clamp(roundStep(finite(src.repay, 0), u), 0, state.loan);
    if (borrow > 0 && repay > 0) { const net = borrow - repay; borrow = Math.max(0, net); repay = Math.max(0, -net); }
    out.borrow = borrow; out.repay = repay;
  }
  return out;
}

export function lotsQty(lots: Lot[]): number { return lots.reduce((s, l) => s + l.qty, 0); }
export function lotsValue(lots: Lot[]): number { return lots.reduce((s, l) => s + l.value, 0); }

/**
 * 「需要予測に合わせる」：この価格・広告での予測需要（四半期）から持ち越し在庫を引き、13週で割った数を毎週の仕入れにする。
 * 価格・人員・広告は変えない。
 */
export function suggestedOrder(state: CoreState, dec: Decisions, id: ProductId, margin = 0): number {
  const env = getTurnEnv(state, state.turn);
  const ad = diffOf(state).features.ad ? dec.ad : 0;
  const need = expectedDemand(env, id, dec.prices[id], ad) * (1 + margin) - lotsQty(state.inventory[id]);
  return clamp(roundStep(Math.max(0, need) / WEEKS_PER_TURN, C.purchase.step), 0, C.purchase.maxPerWeek);
}

export interface Outlook {
  env: TurnEnv;
  rows: { id: ProductId; demandAtRef: number; demandAtPrice: number; cost: number; carry: number; carryValue: number }[];
  totalDemand: number;
  capacity: number;
}
export function outlook(state: CoreState, raw: unknown): Outlook {
  const env = getTurnEnv(state, state.turn);
  const n = normalizeDecisions(state, raw);
  const rows = PRODUCT_IDS.map(id => ({
    id,
    demandAtRef: Math.round(env.products[id].demandBase),
    demandAtPrice: Math.round(expectedDemand(env, id, n.prices[id], n.ad)),
    cost: env.products[id].cost,
    carry: lotsQty(state.inventory[id]),
    carryValue: lotsValue(state.inventory[id])
  }));
  return { env, rows, totalDemand: rows.reduce((s, r) => s + r.demandAtPrice, 0), capacity: n.staff * C.staff.capacityPerWeek * WEEKS_PER_TURN };
}

export function shelfWeeks(id: ProductId, fridge: boolean): number {
  const p = productById(id);
  return p.shelfWeeks + (fridge ? p.fridgeBonusWeeks : 0);
}
