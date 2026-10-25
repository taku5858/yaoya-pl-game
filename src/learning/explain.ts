/*
 * 結果の解説文。数字はすべて TurnResult から取り、PLの表示と一致させる（外部AIは使わない）。
 */
import { gameConfig as C } from '../config/gameConfig';
import { adLift, money, productById, stateBefore } from '../engine';
import type { CoreState, TurnResult } from '../engine';
import { breakEven, cashBridgeItems, fridgeEffect, opDrivers } from './analysis';
import type { Driver, FridgeEffect } from './analysis';
import { man, pct, qty, stageOf, turnLabel, yen } from './format';

/** 営業利益の変化を、実際に動いた項目で説明する一文 */
export function opSentence(r: TurnResult, p: TurnResult): string {
  const dOP = r.pl.operatingProfit - p.pl.operatingProfit;
  const dRev = r.pl.revenue - p.pl.revenue;
  const costs = opDrivers(r, p).filter(x => x.sign < 0);
  const opPart = dOP === 0 ? '営業利益は前期と同じでした' : `営業利益は ${man(Math.abs(dOP))} ${dOP > 0 ? '増えました' : '減りました'}`;
  const word = (x: Driver) => `${x.label}が ${man(Math.abs(x.delta))} ${x.delta > 0 ? '増えた' : '減った'}`;
  const opposing = costs.filter(x => (dRev > 0 && x.effect < 0) || (dRev < 0 && x.effect > 0));
  let s: string;
  let used: Driver[];
  if (dRev !== 0 && dOP !== 0 && Math.sign(dOP) !== Math.sign(dRev) && opposing.length) {
    used = opposing.slice(0, 2);
    s = `売上は前期より ${man(Math.abs(dRev))} ${dRev > 0 ? '増えました' : '減りました'}が、${used.map(word).join('うえ、')}ため、${opPart}。`;
  } else if (costs.length) {
    used = costs.slice(0, 2);
    const revPart = dRev === 0 ? '売上は前期と同じで' : `売上は前期より ${man(Math.abs(dRev))} ${dRev > 0 ? '増え' : '減り'}`;
    s = `${revPart}、${used.map(word).join('、')}結果、${opPart}。`;
  } else {
    used = [];
    s = dRev === 0 ? '売上も費用も前期と同じでした。' : `費用は変わらず、売上が前期より ${man(Math.abs(dRev))} ${dRev > 0 ? '増えた' : '減った'}ため、${opPart}。`;
  }
  const rest = costs.filter(x => !used.includes(x));
  if (rest.length) s += `ほかに ${rest.map(x => `${x.label} ${man(x.delta, { plus: true })}`).join('、')} も動いています。`;
  return s;
}

export interface Note { kind: string; weight: number; text: string }
export interface TurnExplanation {
  headline: string;
  summary: string;
  drivers: Driver[];
  notes: Note[];
  points: string[];
  inventory: string;
  cash: string;
  fridge: FridgeEffect | null;
  fridgeText: string | null;
}

/** history[index] の結果の解説 */
export function explainTurn(state: CoreState, index: number): TurnExplanation {
  const r = state.history[index].result;
  const p = index > 0 ? state.history[index - 1].result : null;
  return explainResult(state.difficulty, r, p, stateBefore(state, index));
}

export function explainResult(difficulty: CoreState['difficulty'], r: TurnResult, p: TurnResult | null, before: CoreState | null): TurnExplanation {
  const st = stageOf(r.turn);
  const op = r.pl.operatingProfit;
  const drivers = p ? opDrivers(r, p) : [];
  const summary = p ? opSentence(r, p)
    : `最初の期は、売上高 ${man(r.pl.revenue)} から売上原価 ${man(r.pl.cogs)} を引いた粗利が ${man(r.pl.grossProfit)}。そこから${st >= 1 ? '販管費' : '経費'} ${man(r.pl.sga)} を引いて、営業利益（本業のもうけ）は ${man(op)} でした。`;
  const notes: Note[] = [];

  r.rows.forEach((x, i) => {
    const prev = p ? p.rows[i] : null;
    if (x.stockout > x.demand * 0.03 && x.stockout >= 200) {
      notes.push({ kind: 'stockout', weight: x.stockout * (x.price - x.unitCost),
        text: `${x.emoji}${x.name}は需要 ${qty(x.demand)} のうち ${qty(x.stockout)} が在庫切れで売れませんでした（毎週の仕入れ ${qty(x.orderPerWeek)}）。取れたはずの粗利は約 ${man(money(x.stockout * (x.price - x.unitCost)))}（機会損失・PLには載りません）。` });
    }
    if (x.waste >= 200) {
      notes.push({ kind: 'waste', weight: x.wasteCost,
        text: `${x.emoji}${x.name}は売れる期間（${x.shelfWeeks}週）を過ぎた ${qty(x.waste)} を廃棄し、廃棄原価は ${man(x.wasteCost)}（売上原価に含む）。週ごとの売れ行きのばらつきで、多めに仕入れた週の残りが傷みました。` });
    }
    if (prev && x.price !== prev.price) {
      notes.push({ kind: 'price', weight: Math.abs(x.revenue - prev.revenue),
        text: `${x.emoji}${x.name}を ${yen(prev.price)}→${yen(x.price)} に${x.price > prev.price ? '値上げ' : '値下げ'}。1個あたりの粗利（仕入れ値との差）は ${yen(prev.price - prev.unitCost)}→${yen(x.price - x.unitCost)}、販売数は ${qty(prev.sold)}→${qty(x.sold)}。` });
    }
  });
  if (r.totals.capacityLost > 0) {
    notes.push({ kind: 'capacity', weight: r.rows.reduce((s, x) => s + x.capacityLost * (x.price - x.unitCost), 0),
      text: `人手が足りず、${qty(r.totals.capacityLost)} 分のお客さんを逃しました（販売できる上限は週 ${qty(r.capacityPerWeek)}）。1人増やすと人件費が ${man(r.env.wage)} 増えます。` });
  } else if (r.capacity - r.totals.sold > C.staff.capacityPerWeek * C.weeksPerTurn) {
    notes.push({ kind: 'overstaff', weight: r.env.wage,
      text: `販売できる上限 ${qty(r.capacity)} に対して販売は ${qty(r.totals.sold)}。1人分以上の余裕があり、人件費 ${man(r.env.wage)} を減らせたかもしれません。` });
  }
  if (p && r.pl.labor !== p.pl.labor) {
    notes.push({ kind: 'staff', weight: Math.abs(r.pl.labor - p.pl.labor),
      text: `人員 ${p.decisions.staff}人→${r.decisions.staff}人で、人件費は ${man(r.pl.labor - p.pl.labor, { plus: true })}。販売できる上限は ${qty(p.capacity)}→${qty(r.capacity)}。` });
  }
  if (r.pl.advertising) {
    notes.push({ kind: 'ad', weight: r.pl.advertising,
      text: `広告費 ${man(r.pl.advertising)} で需要の予測が約${Math.round(adLift(r.pl.advertising) * 100)}%増えました。増えた需要で売れた分の粗利が広告費を上回れば、営業利益にはプラスです。` });
  }
  for (const ev of r.env.events) {
    const pr = ev.product ? productById(ev.product) : null;
    if (ev.type === 'costSpike' && pr && ev.mult) notes.push({ kind: 'event', weight: 1e12, text: `⚠️ ${pr.name}の仕入れ値が高騰（+${Math.round((ev.mult - 1) * 100)}%）。同じ価格で売ると1個あたりの粗利が減ります。` });
    if (ev.type === 'competitor' && pr && ev.mult) notes.push({ kind: 'event', weight: 1e12, text: `⚠️ 近くのスーパーが${pr.name}を安売り中。同じ価格だと需要が約${Math.round((1 - ev.mult) * 100)}%減ります。` });
    if (ev.type === 'boom' && pr && ev.mult) notes.push({ kind: 'event', weight: 1e12, text: `📺 テレビで${pr.name}が話題に。需要が約${Math.round((ev.mult - 1) * 100)}%増えました。` });
  }

  // 冷蔵設備の効果（同じ乱数で設備なしと比較）
  const fe = before ? fridgeEffect(before, r) : null;
  let fridgeText: string | null = null;
  if (fe) {
    fridgeText = `同じ需要で冷蔵設備がなかった場合と比べると、廃棄原価は ${man(fe.wasteWithout)}→${man(fe.wasteWith)}、粗利は ${man(fe.grossWith - fe.grossWithout, { plus: true })}。設備の費用（減価償却費＋電気代）${man(fe.cost)} を引いた営業利益への効果は ${man(fe.opEffect, { plus: true })}。` +
      (fe.opEffect < 0 ? '廃棄がもともと少ないと、設備の費用を回収できません。' : '');
    notes.push({ kind: 'fridge', weight: 1e11, text: '🧊 ' + fridgeText });
  }

  const dInv = r.inventory.end - r.inventory.begin;
  const inventory = `今期の仕入れは ${man(r.inventory.purchases)}。そのうち費用（売上原価）になったのは「売れた分 ${man(r.inventory.cogsSold)}」と「捨てた分 ${man(r.inventory.cogsWaste)}」です。` +
    (dInv > 0 ? `在庫は ${man(dInv)} 増えました。この分は仕入れたけれど、まだ費用になっていません。`
      : dInv < 0 ? `在庫は ${man(-dInv)} 減りました。前の期に仕入れた野菜を今期売ったので、その分は今期の費用です。` : '在庫の金額は変わりませんでした。');
  const bridge = cashBridgeItems(r).slice(1);
  const cash = `営業利益は ${man(op)}、手元資金の増減は ${man(r.cash.change, { plus: true })}。` +
    (bridge.length ? '差の理由：' + bridge.map(x => `${x.label} ${man(x.value, { plus: true })}`).join('、') + '。' : '今回は利益とお金の増減が一致しました。') +
    `期中でいちばん少なかった手元資金は ${man(r.cash.min)}（${r.cash.minWhen}）。`;

  notes.sort((a, b) => b.weight - a.weight);
  const points = [summary, ...notes.slice(0, 2).map(n => n.text)];
  const b = breakEven(r);
  if (st >= 2 && r.pl.revenue > 0) points.push(`粗利率は ${pct(b.gpMargin)}${p && p.pl.revenue ? `（前期 ${pct(p.pl.grossProfit / p.pl.revenue)}）` : ''}。`);
  if (st >= 3 && b.breakEven !== null) points.push(`損益分岐点売上高は約 ${man(b.breakEven)}（近似）。今の売上はそれを ${man(b.safety ?? 0, { plus: true })} ${(b.safety ?? 0) >= 0 ? '上回っています' : '下回っています'}。`);
  if (difficulty === 'hard' && r.pl.interest) points.push(`支払利息 ${man(r.pl.interest)} を引いた経常利益は ${man(r.pl.ordinaryProfit)}。`);

  return { headline: op >= 0 ? `営業利益 ${man(op)} の黒字` : `営業利益 ${man(op)} の赤字`, summary, drivers, notes, points, inventory, cash, fridge: fe, fridgeText };
}

/** 同じ乱数での比較（a: 実際、b: 別の判断） */
export function compareText(a: TurnResult, b: TurnResult): string {
  const d = b.pl.operatingProfit - a.pl.operatingProfit;
  const ds = opDrivers(b, a).slice(0, 3);
  const head = d === 0 ? '営業利益は同じです。' : `別の判断なら、営業利益は ${man(Math.abs(d))} ${d > 0 ? '多く' : '少なく'}なっていました。`;
  const body = ds.length ? '主な違い：' + ds.map(x => `${x.label} ${man(x.delta, { plus: true })}（利益に ${man(x.effect, { plus: true })}）`).join('、') + '。' : '';
  const extra: string[] = [];
  if (b.totals.waste !== a.totals.waste) extra.push(`廃棄 ${qty(a.totals.waste)}→${qty(b.totals.waste)}`);
  const lostA = a.totals.stockout + a.totals.capacityLost, lostB = b.totals.stockout + b.totals.capacityLost;
  if (lostA !== lostB) extra.push(`売り逃し ${qty(lostA)}→${qty(lostB)}`);
  if (b.cash.end !== a.cash.end) extra.push(`期末資金 ${man(a.cash.end)}→${man(b.cash.end)}`);
  return head + body + (extra.length ? ' ' + extra.join('、') + '。' : '');
}

/** 資金ショートの原因 */
export function shortageReasons(r: TurnResult, hard: boolean): string[] {
  const lines = [`期中でいちばん少ないときの手元資金が ${man(r.cash.min)}（${r.cash.minWhen}）になり、支払いができなくなります。期末の手元資金は ${man(r.cash.end)}。`];
  if (r.pl.operatingProfit < 0) lines.push(`営業利益が ${man(r.pl.operatingProfit)} の赤字。粗利 ${man(r.pl.grossProfit)} で販管費 ${man(r.pl.sga)} をまかなえていません。`);
  for (const x of cashBridgeItems(r).slice(1)) if (x.value < 0) lines.push(`${x.label}：${man(x.value)}`);
  lines.push(`仕入れ代金は毎週、家賃は期首、人件費などは期末に支払います。売上の入金より先に支払いが来ると、利益が出ていても資金が足りなくなることがあります。`);
  lines.push('対策の例：仕入れを需要に合わせる、人員や広告を見直す、' + (hard ? '借入で資金を補う、設備投資の時期をずらす。' : '価格を見直す。'));
  return lines;
}

// ---------- 最終評価 ----------
export function evaluate(state: CoreState, quizCorrect: boolean[], quizTags: string[]) {
  const d = C.difficulties[state.difficulty];
  const hs = state.history.map(h => h.result);
  const sum = (f: (r: TurnResult) => number) => hs.reduce((s, r) => s + f(r), 0);
  const rate = state.cumOP / d.target;
  const grade = rate >= 1.3 ? 'S' : rate >= 1 ? 'A' : rate >= 0.8 ? 'B' : rate >= 0.5 ? 'C' : 'D';
  const business = {
    cumOP: state.cumOP, target: d.target, rate, grade,
    revenue: sum(r => r.pl.revenue), wasteCost: sum(r => r.pl.cogsWaste), wasteQty: sum(r => r.totals.waste),
    wasteRate: sum(r => r.pl.cogsWaste) / Math.max(1, sum(r => r.pl.cogs)),
    lostQty: sum(r => r.totals.stockout + r.totals.capacityLost), demand: sum(r => r.totals.demand),
    opportunityLoss: sum(r => r.totals.opportunityLoss),
    cash: state.cash, loan: state.loan, minCash: state.minCash, cumOrdinary: state.cumOrdinary,
    redTurns: hs.filter(r => r.pl.operatingProfit < 0).length,
    lostRate: 0,
    fridgeBook: state.fridge.owned ? state.fridge.bookValue : 0
  };
  business.lostRate = business.lostQty / Math.max(1, business.demand);
  const preds = state.history.map(h => h.prediction).filter((x): x is NonNullable<typeof x> => !!x);
  const predCorrect = preds.filter(p => p.correct).length;
  const qc = quizCorrect.filter(Boolean).length;
  const score = Math.round((preds.length ? predCorrect / preds.length : 0) * 50 + (qc / 5) * 50);
  const ugrade = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 50 ? 'B' : score >= 30 ? 'C' : 'D';
  const tags: Record<string, { ok: number; ng: number }> = {};
  const add = (tag: string, ok: boolean) => { tags[tag] = tags[tag] || { ok: 0, ng: 0 }; tags[tag][ok ? 'ok' : 'ng']++; };
  preds.forEach(p => add(p.tag, p.correct));
  quizCorrect.forEach((ok, i) => add(quizTags[i], ok));
  const names: Record<string, string> = { revenue: '売上高', grossProfit: '粗利', inventory: '在庫と売上原価', operatingProfit: '営業利益', sga: '販管費', gpMargin: '粗利率', fixedCost: '固定費と変動費', breakEven: '損益分岐点', cash: '利益と手元資金の違い' };
  const strong: string[] = [], weak: string[] = [];
  Object.entries(tags).forEach(([k, v]) => (v.ok >= v.ng ? strong : weak).push(names[k] ?? k));
  return {
    business,
    understanding: { predCorrect, predTotal: preds.length, quizCorrect: qc, score, grade: ugrade, strong, weak },
    review: reviewExamples(state)
  };
}

/** 「あなたの判断がPLをどう変えたか」 */
export function reviewExamples(state: CoreState): { title: string; text: string }[] {
  const hs = state.history.map(h => h.result);
  const ex: { title: string; text: string }[] = [];
  if (!hs.length) return ex;
  const best = hs.reduce((a, b) => (b.pl.operatingProfit > a.pl.operatingProfit ? b : a));
  const worst = hs.reduce((a, b) => (b.pl.operatingProfit < a.pl.operatingProfit ? b : a));
  ex.push({ title: '最も利益が出た期', text: `${turnLabel(best.turn)}：売上高 ${man(best.pl.revenue)}、粗利 ${man(best.pl.grossProfit)}、営業利益 ${man(best.pl.operatingProfit)}。人員${best.decisions.staff}人・廃棄原価 ${man(best.pl.cogsWaste)}・売り逃し ${qty(best.totals.stockout + best.totals.capacityLost)}。` });
  if (worst !== best) ex.push({ title: '最も利益が少なかった期', text: `${turnLabel(worst.turn)}：営業利益 ${man(worst.pl.operatingProfit)}。最良の期と比べると、売上高 ${man(worst.pl.revenue - best.pl.revenue, { plus: true })}、売上原価 ${man(worst.pl.cogs - best.pl.cogs, { plus: true })}、販管費 ${man(worst.pl.sga - best.pl.sga, { plus: true })}。` });
  for (let i = 1; i < hs.length; i++) {
    if (hs[i].pl.revenue > hs[i - 1].pl.revenue && hs[i].pl.operatingProfit < hs[i - 1].pl.operatingProfit) {
      ex.push({ title: '売上が増えたのに利益が減った期', text: `${turnLabel(hs[i].turn)}：${opSentence(hs[i], hs[i - 1])}` });
      break;
    }
  }
  const wasteMax = hs.reduce((a, b) => (b.pl.cogsWaste > a.pl.cogsWaste ? b : a));
  if (wasteMax.pl.cogsWaste > 0) ex.push({ title: '廃棄が最も多かった期', text: `${turnLabel(wasteMax.turn)}：${qty(wasteMax.totals.waste)} を廃棄し、廃棄原価 ${man(wasteMax.pl.cogsWaste)} が売上原価に入りました。仕入れ ${qty(wasteMax.totals.purchaseQty)} に対し販売 ${qty(wasteMax.totals.sold)}。` });
  let priceEx: { r: TurnResult; i: number } | null = null;
  for (let t = 1; t < hs.length && !priceEx; t++) hs[t].rows.forEach((x, i) => { if (!priceEx && x.price !== hs[t - 1].rows[i].price) priceEx = { r: hs[t], i }; });
  if (priceEx) {
    const { r, i } = priceEx as { r: TurnResult; i: number };
    const x = r.rows[i], y = hs[r.turn - 1].rows[i];
    ex.push({ title: '価格を変えた判断', text: `${turnLabel(r.turn)}：${x.name}を ${yen(y.price)}→${yen(x.price)}。販売数 ${qty(y.sold)}→${qty(x.sold)}、この商品の粗利 ${man(y.grossProfit)}→${man(x.grossProfit)}（季節や仕入れ値の変化も含みます）。` });
  }
  for (let t = 1; t < hs.length; t++) {
    if (hs[t].decisions.staff !== hs[t - 1].decisions.staff) {
      const a = hs[t - 1], b = hs[t];
      ex.push({ title: '人員を変えた判断', text: `${turnLabel(b.turn)}：${a.decisions.staff}人→${b.decisions.staff}人。人件費 ${man(b.pl.labor - a.pl.labor, { plus: true })}、販売数 ${qty(b.totals.sold - a.totals.sold, { plus: true })}、人手不足の売り逃し ${qty(a.totals.capacityLost)}→${qty(b.totals.capacityLost)}。` });
      break;
    }
  }
  const fr = hs.find(r => r.fridge.boughtNow);
  if (fr) {
    const deps = hs.reduce((s, r) => s + r.pl.depreciation, 0);
    let effect = 0;
    state.history.forEach((h, i) => { if (h.result.fridge.owned) effect += fridgeEffect(stateBefore(state, i), h.result)?.opEffect ?? 0; });
    ex.push({ title: '冷蔵設備への投資', text: `${turnLabel(fr.turn)}に ${man(C.fridge.price)} を支払いました。費用（減価償却費）になったのは ${man(deps)} で、残りの ${man(state.fridge.bookValue)} は設備の価値として残っています。この残りは累計営業利益には足していません（費用になっていないだけで、もうけではありません）。同じ需要で設備がなかった場合と比べた営業利益への効果は、合計 ${man(effect, { plus: true })} でした。` });
  }
  ex.push({ title: '利益とお金', text: `5年間の累計営業利益は ${man(state.cumOP)}、手元資金の増減は ${man(state.cash - C.difficulties[state.difficulty].startCash, { plus: true })}${state.loan ? `（借入残高 ${man(state.loan)} を含む）` : ''}。差は在庫・設備・借入・利息などによるものです。` });
  return ex;
}
