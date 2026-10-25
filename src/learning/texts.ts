/*
 * 用語集・PLの行・年はじめの学習カード・ヒント
 */
import { gameConfig as C, WEEKS_PER_TURN } from '../config/gameConfig';
import type { DifficultyKey } from '../config/gameConfig';
import { lotsQty, normalizeDecisions, productById, shelfWeeks } from '../engine';
import type { CoreState, Decisions, Outlook, TurnResult } from '../engine';
import { breakEven } from './analysis';
import { man, pct, qty, stageOf, yen } from './format';

export interface GlossaryEntry {
  id: string;
  term: string;
  stage: number;
  hardOnly?: boolean;
  short: string;
  example: (r: TurnResult) => string;
}

export const glossary: GlossaryEntry[] = [
  { id: 'revenue', term: '売上高', stage: 0, short: 'お客さんに野菜を売って受け取ったお金の合計。',
    example: r => `今回は ${r.rows.map(x => `${x.name} ${yen(x.price)}×${qty(x.sold)}`).join('、')} で、売上高は ${man(r.pl.revenue)}。` },
  { id: 'cogs', term: '売上原価', stage: 0, short: '売れた野菜の仕入れ値（原価）と、捨てた野菜の原価の合計。仕入れた金額そのものではありません。',
    example: r => `今回の仕入れは ${man(r.inventory.purchases)} でしたが、売上原価は ${man(r.pl.cogs)}（販売分 ${man(r.pl.cogsSold)}＋廃棄分 ${man(r.pl.cogsWaste)}）。差は在庫の増減です。` },
  { id: 'grossProfit', term: '粗利（売上総利益）', stage: 0, short: '売上から、売れた野菜の原価や廃棄原価を引いた残り。このお金で家賃や人件費をまかないます。',
    example: r => `売上高 ${man(r.pl.revenue)} − 売上原価 ${man(r.pl.cogs)} ＝ 粗利 ${man(r.pl.grossProfit)}。` },
  { id: 'operatingProfit', term: '営業利益', stage: 0, short: 'お店の本業でもうかった金額。粗利から販管費（家賃・人件費など）を引いて求めます。このゲームの目標です。',
    example: r => `粗利 ${man(r.pl.grossProfit)} − 販管費 ${man(r.pl.sga)} ＝ 営業利益 ${man(r.pl.operatingProfit)}。` },
  { id: 'inventory', term: '在庫', stage: 0, short: '売れ残ってまだ売れる野菜。仕入れ値（原価）で数えます。費用になるのは、売れたとき・捨てたときです。',
    example: r => `期首在庫 ${man(r.inventory.begin)} ＋ 当期仕入 ${man(r.inventory.purchases)} ＝ 販売分の原価 ${man(r.inventory.cogsSold)} ＋ 廃棄原価 ${man(r.inventory.cogsWaste)} ＋ 期末在庫 ${man(r.inventory.end)}。` },
  { id: 'shelf', term: '売れる期間（鮮度）', stage: 0, short: '入荷してから売れる週数。過ぎると傷んで廃棄します。1期は13週あり、毎週仕入れて毎週売ります。',
    example: r => r.rows.map(x => `${x.name} ${x.shelfWeeks}週`).join('、') + '。期末に持ち越せるのは、まだ売れる期間が残っている分だけです。' },
  { id: 'waste', term: '廃棄原価', stage: 0, short: '売れる期間を過ぎて捨てた野菜の原価。売上原価の中に含めて、内訳として別に表示します（二重には数えません）。',
    example: r => `今回は ${qty(r.totals.waste)} を捨て、その原価 ${man(r.pl.cogsWaste)} が売上原価に入っています。` },
  { id: 'opportunity', term: '機会損失', stage: 0, short: '欠品や人手不足で「売れたはずなのに売れなかった」分の粗利。参考値で、PLの費用には入りません。',
    example: r => `今回は ${qty(r.totals.stockout + r.totals.capacityLost)} を売り逃し、取れたはずの粗利は約 ${man(r.totals.opportunityLoss)}（PLには載りません）。` },
  { id: 'cash', term: '手元資金', stage: 0, short: '実際にお店にあるお金。利益とは別物で、仕入れや設備の代金を払うと減り、売上の入金で増えます。',
    example: r => `期首 ${man(r.cash.begin)} → 期末 ${man(r.cash.end)}（${man(r.cash.change, { plus: true })}）。営業利益は ${man(r.pl.operatingProfit)} でした。` },
  { id: 'forecast', term: '需要予測', stage: 0, short: '「この価格なら、これくらい買いに来そう」という見込み。販売の保証ではありません。実際の販売数は、価格・人員（販売能力）・在庫・予測の誤差で変わります。',
    example: r => r.rows.map(x => `${x.name}：予測 ${qty(x.expDemand)} → 実際の需要 ${qty(x.demand)} → 販売 ${qty(x.sold)}`).join('、') + '。' },
  { id: 'sga', term: '販管費', stage: 1, short: '「販売費及び一般管理費」。お店を回すための費用で、人件費・家賃・広告費・水道光熱費など。',
    example: r => `人件費 ${man(r.pl.labor)}＋家賃 ${man(r.pl.rent)}＋広告費 ${man(r.pl.advertising)}＋水道光熱費 ${man(r.pl.utilities)}${r.pl.depreciation ? `＋減価償却費 ${man(r.pl.depreciation)}` : ''} ＝ ${man(r.pl.sga)}。` },
  { id: 'gpMargin', term: '粗利率', stage: 2, short: '売上のうち粗利が何%残るか。値上げ・仕入れ値の下落・廃棄の減少で上がります。',
    example: r => `粗利 ${man(r.pl.grossProfit)} ÷ 売上高 ${man(r.pl.revenue)} ＝ ${pct(r.pl.revenue ? r.pl.grossProfit / r.pl.revenue : 0)}。` },
  { id: 'costView', term: '費用の2つの見方', stage: 2, short: 'PLは費用を「売上原価」と「販管費」に分けます。これとは別に、費用が売れた量で変わるか（変動費）変わらないか（固定費）で分ける見方があります。同じ費用でも、見方によって入る箱が違います。',
    example: r => `たとえば人件費 ${man(r.pl.labor)} はPLでは販管費、性質では固定費。販売分の原価 ${man(r.pl.cogsSold)} はPLでは売上原価、性質では変動費です。` },
  { id: 'variableCost', term: '変動費', stage: 2, short: '売れた数量に比例して増える費用。このゲームでは「販売分の仕入原価」が変動費です。',
    example: r => `今回の変動費（販売分の原価）は ${man(r.pl.cogsSold)}。売上高の ${pct(r.pl.revenue ? r.pl.cogsSold / r.pl.revenue : 0)} です。` },
  { id: 'fixedCost', term: '固定費', stage: 2, short: '売上の多い少ないに関係なくかかる費用。このゲームでは家賃・決めた人数分の人件費・水道光熱費・減価償却費。広告費はあなたが決める費用、廃棄原価は仕入れと売れ残りで変わる費用として別に扱います。',
    example: r => { const b = breakEven(r); return `今回の固定費は ${man(b.fixed)}。ほかに広告費 ${man(b.discretionary)}、廃棄原価 ${man(b.waste)}。`; } },
  { id: 'marginal', term: '限界利益率', stage: 3, short: '売上から変動費（販売分の原価）を引いた残り（限界利益）が、売上の何%か。売上が1万円増えると、この割合だけ利益が増えます（廃棄や人員が変わらない場合）。粗利率とは廃棄原価を含むかどうかが違います。',
    example: r => { const b = breakEven(r); return `（売上高 ${man(b.revenue)} − 変動費 ${man(b.variable)}）÷ 売上高 ＝ ${pct(b.marginalRate)}。`; } },
  { id: 'breakEven', term: '損益分岐点', stage: 3, short: '営業利益がちょうど0になる売上高。このゲームでは（固定費＋広告費＋廃棄原価）÷ 限界利益率 で求める近似です（価格・原価率・人員・広告・廃棄が今期と同じと仮定）。',
    example: r => { const b = breakEven(r); return b.breakEven === null ? '限界利益がマイナスのため、今回は計算できません。' : `（${man(b.fixed)}＋${man(b.discretionary)}＋${man(b.waste)}）÷ ${pct(b.marginalRate)} ≒ ${man(b.breakEven)}。今回の売上高との差は ${man(b.safety ?? 0, { plus: true })}。`; } },
  { id: 'depreciation', term: '減価償却費', stage: 0, hardOnly: true, short: '設備の購入代金を、使う期間（5年＝20期）に分けて少しずつ費用にしたもの。お金は買った期に払い終わっているので、毎期の減価償却費ではお金は出ていきません。',
    example: r => r.pl.depreciation ? `冷蔵設備 ${man(C.fridge.price)} ÷ ${C.fridge.lifeQuarters}期 ＝ 毎期 ${man(r.pl.depreciation)} が販管費に入ります。` : `冷蔵設備を買うと、代金 ${man(C.fridge.price)} を${C.fridge.lifeQuarters}期に分けて毎期費用にします。` },
  { id: 'interest', term: '支払利息', stage: 1, hardOnly: true, short: '借りたお金にかかる利息。本業以外の費用なので、営業利益の下で引きます。借入の元本や返済は費用ではありません。',
    example: r => `借入残高 ${man(r.loan.end)} × 年${(C.loan.annualRate * 100).toFixed(0)}% ÷ 4 ＝ ${man(r.pl.interest)}。` },
  { id: 'ordinaryProfit', term: '経常利益', stage: 1, hardOnly: true, short: '営業利益から、利息など本業以外の損益を加減したもの。借入が多いと営業利益より小さくなります。',
    example: r => `営業利益 ${man(r.pl.operatingProfit)} − 支払利息 ${man(r.pl.interest)} ＝ 経常利益 ${man(r.pl.ordinaryProfit)}。` },
  { id: 'tax', term: '税金について', stage: 0, short: '本物のPLでは、このあと特別損益や法人税等を引いて「当期純利益」を出します。このゲームでは学習のため税金などを省略しています。',
    example: () => '営業利益（むずかしいでは経常利益）までを扱います。' }
];

export function glossaryFor(difficulty: DifficultyKey, turn: number) {
  const st = stageOf(Math.min(turn, C.totalTurns - 1));
  return glossary.filter(g => !g.hardOnly || difficulty === 'hard').map(g => ({ ...g, unlocked: g.stage <= st }));
}
export function termById(id: string): GlossaryEntry | undefined {
  return glossary.find(g => g.id === id);
}

// ---------- PLの行 ----------
export interface PlLine { key: keyof TurnResult['pl']; label: string; level: 0 | 1; term?: string; kind: 'income' | 'cost' | 'profit'; strong?: boolean; op?: string; note?: string }
export function plLines(difficulty: DifficultyKey, turn: number): PlLine[] {
  const st = stageOf(turn);
  const hard = difficulty === 'hard';
  const lines: PlLine[] = [
    { key: 'revenue', label: '売上高', level: 0, term: 'revenue', kind: 'income' },
    { key: 'cogs', label: '売上原価', level: 0, term: 'cogs', kind: 'cost', op: '−' },
    { key: 'cogsSold', label: 'うち 販売分の原価', level: 1, kind: 'cost' },
    { key: 'cogsWaste', label: 'うち 廃棄原価', level: 1, term: 'waste', kind: 'cost' },
    { key: 'grossProfit', label: '売上総利益（粗利）', level: 0, term: 'grossProfit', kind: 'profit', strong: true, op: '＝' },
    { key: 'sga', label: st >= 1 ? '販管費' : '経費（家賃・人件費など）', level: 0, term: st >= 1 ? 'sga' : undefined, kind: 'cost', op: '−' }
  ];
  if (st >= 1) {
    lines.push({ key: 'labor', label: 'うち 人件費', level: 1, kind: 'cost' });
    lines.push({ key: 'rent', label: 'うち 家賃', level: 1, kind: 'cost' });
    if (difficulty !== 'easy') lines.push({ key: 'advertising', label: 'うち 広告費', level: 1, kind: 'cost' });
    lines.push({ key: 'utilities', label: 'うち 水道光熱費', level: 1, kind: 'cost' });
  }
  if (hard) lines.push({ key: 'depreciation', label: 'うち 減価償却費', level: 1, term: 'depreciation', kind: 'cost' });
  lines.push({ key: 'operatingProfit', label: '営業利益', level: 0, term: 'operatingProfit', kind: 'profit', strong: true, op: '＝', note: 'お店の本業でもうかった金額' });
  if (hard) {
    lines.push({ key: 'interest', label: '支払利息', level: 0, term: 'interest', kind: 'cost', op: '−' });
    lines.push({ key: 'ordinaryProfit', label: '経常利益', level: 0, term: 'ordinaryProfit', kind: 'profit', strong: true, op: '＝' });
  }
  return lines;
}

// ---------- 年はじめの学習カード ----------
export function stageIntro(difficulty: DifficultyKey, stage: number) {
  const s = C.stages[stage];
  const extra: string[] = [];
  if (stage === 0) {
    extra.push('1期は3か月（13週）。毎週同じ数を仕入れ、毎週売ります。野菜には「売れる期間」があり、過ぎた売れ残りは廃棄します。');
    extra.push('PLの上から「売上高 − 売上原価 ＝ 粗利」。売上原価は売れた分と捨てた分の原価だけで、まだ売れる売れ残りは「在庫」として次の期へ持ち越します。');
  }
  if (stage === 1) extra.push('粗利 − 販管費（人件費・家賃・広告費・水道光熱費' + (difficulty === 'hard' ? '・減価償却費' : '') + '）＝ 営業利益。PLの表に内訳が出るようになりました。');
  if (stage === 1 && difficulty === 'hard') extra.push('むずかしいモードでは、営業利益 − 支払利息 ＝ 経常利益 も表示します。');
  if (stage === 2) {
    extra.push('PLの分け方（売上原価・販管費）とは別に、費用を「売れた量で変わるか」で見る切り口があります。');
    extra.push('このゲームの前提：販売分の仕入原価＝変動費、家賃・決めた人数分の人件費・水道光熱費・減価償却費＝固定費、広告費＝あなたが決める費用、廃棄原価＝仕入れと売れ残りで変わる費用。');
  }
  if (stage === 3) extra.push('損益分岐点売上高 ＝（固定費＋広告費＋廃棄原価）÷ 限界利益率。価格や人員などが今期と同じと仮定した近似です。結果画面で、今の売上との差（余裕）が見られます。');
  if (stage === 4) extra.push('最終年です。利益を伸ばしつつ、在庫や資金の動きにも気を配りましょう。終了後に理解度テストがあります。');
  return { title: `${s.year}年目のテーマ：${s.theme}`, lead: s.lead, extra };
}

// ---------- ヒント ----------
export function hintsFor(state: CoreState, dec: Decisions, o: Outlook): string[] {
  const hints: string[] = [];
  const n = normalizeDecisions(state, dec);
  for (const row of o.rows) {
    const p = productById(row.id);
    const supply = n.orders[row.id] * WEEKS_PER_TURN + row.carry;
    const ratio = row.demandAtPrice > 0 ? supply / row.demandAtPrice : 9;
    const shelf = shelfWeeks(row.id, state.fridge.owned);
    if (ratio < 0.95) hints.push(`${p.emoji}${p.name}：予測需要 約${qty(row.demandAtPrice)}（週 約${qty(Math.round(row.demandAtPrice / WEEKS_PER_TURN))}）に対して仕入れが少なめ。欠品しそうです。`);
    else if (ratio > 1.08) hints.push(`${p.emoji}${p.name}：予測需要より多めの仕入れ。売れる期間は${shelf}週なので、売れ残りが続くと廃棄になります。`);
    if (n.prices[row.id] > p.refPrice * 1.15) hints.push(`${p.emoji}${p.name}：価格を標準より大きく上げると、1個の粗利は増えても販売数が大きく減ります。`);
    if (n.prices[row.id] < row.cost * 1.15) hints.push(`${p.emoji}${p.name}：価格が仕入れ値 ${yen(row.cost)} に近く、ほとんど粗利が残りません。`);
  }
  if (o.totalDemand > o.capacity * 1.02) hints.push(`👥 予測需要の合計 約${qty(o.totalDemand)} に対し、販売できる上限は ${qty(o.capacity)}。人手不足でお客さんを逃しそうです。`);
  else if (o.capacity - o.totalDemand > C.staff.capacityPerWeek * WEEKS_PER_TURN) hints.push(`👥 販売できる上限 ${qty(o.capacity)} が予測需要 約${qty(o.totalDemand)} を1人分以上上回っています。人件費を減らせるかもしれません。`);
  for (const ev of o.env.events) {
    const pr = ev.product ? productById(ev.product) : null;
    if (ev.type === 'costSpike' && pr) hints.push(`⚠️ ${pr.name}の仕入れ値が今期だけ高騰中（${yen(o.env.products[pr.id].cost)}）。値上げするか、仕入れを絞るか。`);
    if (ev.type === 'competitor' && pr) hints.push(`⚠️ 競合が${pr.name}を安売り中。値下げで客を取り戻すか、仕入れを減らして損を抑えるか。`);
    if (ev.type === 'boom' && pr) hints.push(`📺 ${pr.name}がブーム。予測需要も増えています。仕入れと人員が足りるか確認を。`);
  }
  for (const ev of o.env.upcoming) if (ev.type === 'wageRise' && ev.wage) hints.push(`📢 来期から人件費が1人あたり ${man(ev.wage)} に上がります。`);
  if (state.difficulty === 'hard' && !state.fridge.owned) {
    const wastes = state.history.slice(-4).map(h => h.result.pl.cogsWaste);
    const avg = wastes.length ? wastes.reduce((a, b) => a + b, 0) / wastes.length : null;
    hints.push(`🧊 冷蔵設備の費用は毎期 ${man(C.fridge.price / C.fridge.lifeQuarters + C.fridge.utilitiesExtra)}（減価償却費＋電気代）。${avg !== null ? `最近の廃棄原価は平均 ${man(Math.round(avg / 1000) * 1000)}/期。` : ''}廃棄がこれより少ないと、営業利益では元を取りにくくなります。`);
  }
  if (lotsQty(state.inventory.tomato) === 0 && state.turn === 0) hints.push('💡 まずは「需要予測に合わせる」で仕入れ数を決め、結果を見てから価格や人員を調整してみましょう。');
  return hints;
}
