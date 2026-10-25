/*
 * 予想問題（各ターン）と最終の理解度テスト。答えと解説は必ず計算結果から作る。
 */
import { money, rngFor } from '../engine';
import type { CoreState, PredictionRecord, TurnResult } from '../engine';
import { breakEven, cashBridgeItems } from './analysis';
import { man, pct, qty, stageOf, turnLabel } from './format';
import { opSentence } from './explain';

interface QuestionDef {
  tag: string;
  text: string;
  options: { key: string; label: string }[];
  needsPrev?: boolean;
  answer: (r: TurnResult, p: TurnResult | null) => string;
  explain: (r: TurnResult, p: TurnResult | null) => string;
}

const pre = (p: TurnResult | null) => p as TurnResult;

export const questionBank: Record<string, QuestionDef> = {
  concept_purchase: {
    tag: 'inventory', text: '今期に仕入れた金額は、全部この期の「売上原価」になる？',
    options: [{ key: 'yes', label: 'なる' }, { key: 'no', label: 'ならない' }],
    answer: r => (r.pl.cogs === r.inventory.purchases ? 'yes' : 'no'),
    explain: r => `売上原価は「売れた分＋捨てた分」の原価だけ。今回は仕入れ ${man(r.inventory.purchases)} に対し、売上原価は ${man(r.pl.cogs)}。まだ売れる ${man(r.inventory.end)} は在庫として次の期へ持ち越しました${r.inventory.begin ? `（期首在庫 ${man(r.inventory.begin)} の分も原価に含まれます）` : ''}。`
  },
  revenue_up: {
    tag: 'revenue', text: '売上高は、前の期より増える？減る？', needsPrev: true,
    options: [{ key: 'up', label: '増える' }, { key: 'down', label: '減る' }],
    answer: (r, p) => (r.pl.revenue >= pre(p).pl.revenue ? 'up' : 'down'),
    explain: (r, p) => `売上高は ${man(pre(p).pl.revenue)} → ${man(r.pl.revenue)}（${man(r.pl.revenue - pre(p).pl.revenue, { plus: true })}）。売上高＝価格×販売数。販売数は ${qty(pre(p).totals.sold)} → ${qty(r.totals.sold)} でした。`
  },
  gp_up: {
    tag: 'grossProfit', text: '粗利（売上総利益）は、前の期より増える？減る？', needsPrev: true,
    options: [{ key: 'up', label: '増える' }, { key: 'down', label: '減る' }],
    answer: (r, p) => (r.pl.grossProfit >= pre(p).pl.grossProfit ? 'up' : 'down'),
    explain: (r, p) => `粗利は ${man(pre(p).pl.grossProfit)} → ${man(r.pl.grossProfit)}（${man(r.pl.grossProfit - pre(p).pl.grossProfit, { plus: true })}）。売上高が ${man(r.pl.revenue - pre(p).pl.revenue, { plus: true })}、売上原価が ${man(r.pl.cogs - pre(p).pl.cogs, { plus: true })} 変わった結果です。`
  },
  waste_any: {
    tag: 'inventory', text: '売れる期間を過ぎて捨てる野菜は、全部で1,000個を超える？',
    options: [{ key: 'yes', label: '超える' }, { key: 'no', label: '超えない' }],
    answer: r => (r.totals.waste > 1000 ? 'yes' : 'no'),
    explain: r => `廃棄は ${qty(r.totals.waste)}、その原価 ${man(r.pl.cogsWaste)}（${r.rows.map(x => `${x.name} ${qty(x.waste)}`).join('、')}）。傷みやすい野菜ほど、週ごとの売れ行きのばらつきで廃棄が出やすくなります。`
  },
  op_up: {
    tag: 'operatingProfit', text: '営業利益（本業のもうけ）は、前の期より増える？減る？', needsPrev: true,
    options: [{ key: 'up', label: '増える' }, { key: 'down', label: '減る' }],
    answer: (r, p) => (r.pl.operatingProfit >= pre(p).pl.operatingProfit ? 'up' : 'down'),
    explain: (r, p) => opSentence(r, pre(p))
  },
  sga_up: {
    tag: 'sga', text: '販管費（人件費・家賃・広告費など）は、前の期より増える？', needsPrev: true,
    options: [{ key: 'up', label: '増える' }, { key: 'down', label: '減る・同じ' }],
    answer: (r, p) => (r.pl.sga > pre(p).pl.sga ? 'up' : 'down'),
    explain: (r, p) => `販管費は ${man(pre(p).pl.sga)} → ${man(r.pl.sga)}（${man(r.pl.sga - pre(p).pl.sga, { plus: true })}）。販管費は売上ではなく、人員・広告などの判断で決まります。`
  },
  gpm_up: {
    tag: 'gpMargin', text: '粗利率（売上に対する粗利の割合）は、前の期より上がる？下がる？', needsPrev: true,
    options: [{ key: 'up', label: '上がる' }, { key: 'down', label: '下がる' }],
    answer: (r, p) => (gpm(r) >= gpm(pre(p)) ? 'up' : 'down'),
    explain: (r, p) => `粗利率は ${pct(gpm(pre(p)))} → ${pct(gpm(r))}。値上げ・仕入れ値の下落・廃棄の減少で上がり、値下げ・仕入れ値の上昇・廃棄の増加で下がります。今回の廃棄原価は ${man(pre(p).pl.cogsWaste)} → ${man(r.pl.cogsWaste)}。`
  },
  fixed_vs: {
    tag: 'fixedCost', text: '今回の売上高が仮に1割減っても、家賃と人件費は同じ？',
    options: [{ key: 'same', label: '同じ' }, { key: 'less', label: '1割減る' }],
    answer: () => 'same',
    explain: r => `同じ、が正解。家賃 ${man(r.pl.rent)} と、決めた人数分の人件費 ${man(r.pl.labor)} は売上に関係なくかかる固定費です。売上が減ると変動費（販売分の原価）は減りますが固定費は残るので、利益は売上以上の割合で減ります。`
  },
  above_bep: {
    tag: 'breakEven', text: '今回の売上高は、損益分岐点（営業利益が0になる売上）を上回る？',
    options: [{ key: 'yes', label: '上回る（黒字）' }, { key: 'no', label: '下回る（赤字）' }],
    answer: r => (r.pl.operatingProfit >= 0 ? 'yes' : 'no'),
    explain: r => {
      const b = breakEven(r);
      return b.breakEven === null ? '限界利益がマイナスのため、どれだけ売っても赤字の状態でした。'
        : `損益分岐点売上高 ≒（固定費 ${man(b.fixed)}＋広告費 ${man(b.discretionary)}＋廃棄原価 ${man(b.waste)}）÷ 限界利益率 ${pct(b.marginalRate)} ≒ ${man(b.breakEven)}。実際の売上高 ${man(r.pl.revenue)} は${(b.safety ?? 0) >= 0 ? '上回り' : '下回り'}、営業利益は ${man(r.pl.operatingProfit)} でした。`;
    }
  },
  cash_vs_op: {
    tag: 'cash', text: '手元資金の増え方は、営業利益より大きい？小さい？',
    options: [{ key: 'more', label: '資金の増加の方が大きい' }, { key: 'less', label: '資金の増加の方が小さい' }],
    answer: r => (r.cash.change >= r.pl.operatingProfit ? 'more' : 'less'),
    explain: r => `営業利益 ${man(r.pl.operatingProfit)} に対し、資金は ${man(r.cash.change, { plus: true })}。${bridgeText(r)}`
  },
  op_positive: {
    tag: 'operatingProfit', text: '今回の営業利益（本業のもうけ）は、黒字（プラス）になる？',
    options: [{ key: 'yes', label: '黒字' }, { key: 'no', label: '赤字' }],
    answer: r => (r.pl.operatingProfit >= 0 ? 'yes' : 'no'),
    explain: r => `営業利益は ${man(r.pl.operatingProfit)}。粗利 ${man(r.pl.grossProfit)} から経費 ${man(r.pl.sga)} を引いた結果です。`
  }
};

function gpm(r: TurnResult) { return r.pl.revenue ? r.pl.grossProfit / r.pl.revenue : 0; }
export function bridgeText(r: TurnResult): string {
  const items = cashBridgeItems(r).slice(1);
  if (!items.length) return '今回は利益とお金の増減が一致しました。';
  return '差の理由：' + items.map(x => `${x.label} ${man(x.value, { plus: true })}`).join('、') + '。';
}

const questionPlan = [
  ['concept_purchase', 'revenue_up', 'gp_up', 'waste_any'],
  ['op_up', 'sga_up', 'op_up', 'gp_up'],
  ['gpm_up', 'fixed_vs', 'op_up', 'gpm_up'],
  ['above_bep', 'op_up', 'above_bep', 'gpm_up'],
  ['cash_vs_op', 'op_up', 'cash_vs_op', 'op_up']
];
export function questionIdFor(turn: number, hasPrev: boolean): string {
  const id = questionPlan[stageOf(turn)][turn % 4];
  return !hasPrev && questionBank[id].needsPrev ? 'op_positive' : id;
}
export function gradePrediction(qid: string, choice: string, r: TurnResult, p: TurnResult | null): PredictionRecord {
  const q = questionBank[qid];
  const answer = q.answer(r, p);
  return { qid, choice, answer, correct: choice === answer, tag: q.tag };
}
export function predictionView(rec: PredictionRecord, r: TurnResult, p: TurnResult | null) {
  const q = questionBank[rec.qid];
  return {
    text: q.text,
    choiceLabel: q.options.find(o => o.key === rec.choice)?.label ?? '',
    answerLabel: q.options.find(o => o.key === rec.answer)?.label ?? '',
    explain: q.explain(r, p)
  };
}

// ---------- 最終の理解度テスト（5問） ----------
export interface QuizQuestion { tag: string; text: string; options: string[]; answer: number; explain: string }

function shuffleFixed<T>(arr: T[], seed: string): T[] {
  const r = rngFor(seed, 'shuffle');
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function buildQuiz(state: CoreState): QuizQuestion[] {
  const hs = state.history.map(h => h.result);
  const last = hs[hs.length - 1];
  const qs: QuizQuestion[] = [];
  let ex: [TurnResult, TurnResult] | null = null;
  for (let i = 1; i < hs.length && !ex; i++) if (hs[i].pl.revenue > hs[i - 1].pl.revenue && hs[i].pl.operatingProfit < hs[i - 1].pl.operatingProfit) ex = [hs[i - 1], hs[i]];
  qs.push({
    tag: 'operatingProfit', text: '売上高が増えれば、営業利益も必ず増える？',
    options: ['必ず増える', '増えるとは限らない', '必ず減る'], answer: 1,
    explain: ex ? `あなたの${turnLabel(ex[1].turn)}が例です。売上高は ${man(ex[1].pl.revenue - ex[0].pl.revenue, { plus: true })} でしたが、営業利益は ${man(ex[1].pl.operatingProfit - ex[0].pl.operatingProfit, { plus: true })} でした。原価や販管費の増え方しだいです。`
      : '値下げで売上を増やしても1個あたりの粗利が減ったり、人を増やして人件費がかさんだりすると、利益は減ります。'
  });
  qs.push({
    tag: 'grossProfit', text: '粗利（売上総利益）の求め方として正しいのは？',
    options: ['売上高 − 当期の仕入れ金額', '売上高 − 売上原価', '売上高 − 販管費'], answer: 1,
    explain: `粗利＝売上高−売上原価。あなたの最終期なら ${man(last.pl.revenue)} − ${man(last.pl.cogs)} ＝ ${man(last.pl.grossProfit)}。仕入れ金額をそのまま引くと、在庫の増減の分だけずれます。`
  });
  const invR = hs.reduce((best, r) => Math.abs(r.inventory.end - r.inventory.begin) > Math.abs(best.inventory.end - best.inventory.begin) ? r : best, hs[0]);
  const inv = invR.inventory;
  const correct = inv.begin + inv.purchases - inv.end;
  const wrongs = [inv.purchases, inv.purchases + inv.end, inv.begin + inv.purchases].filter(v => v !== correct);
  const opts3 = shuffleFixed([man(correct), man(wrongs[0]), man(wrongs.find(v => v !== wrongs[0]) ?? correct + 100000)], state.seed + 'q3');
  qs.push({
    tag: 'inventory', text: `${turnLabel(invR.turn)}は、期首在庫 ${man(inv.begin)}、仕入れ ${man(inv.purchases)}、期末在庫 ${man(inv.end)} でした。売上原価（廃棄分を含む）はいくら？`,
    options: opts3, answer: opts3.indexOf(man(correct)),
    explain: `期首在庫＋仕入れ−期末在庫 ＝ ${man(inv.begin)}＋${man(inv.purchases)}−${man(inv.end)} ＝ ${man(correct)}。売れた分（${man(inv.cogsSold)}）と捨てた分（${man(inv.cogsWaste)}）の原価の合計です。`
  });
  const hard = state.difficulty === 'hard';
  qs.push({
    tag: 'cash', text: '営業利益が黒字なのに、手元資金が営業利益ほど増えない（または減る）理由として正しいのは？',
    options: [hard ? '在庫が増えた・設備を買った・借入を返した' : '在庫が増えた（仕入れた野菜がまだ売れていない）', '家賃を払った', '売上高が増えた'], answer: 0,
    explain: '家賃は費用として利益にもお金にも同じだけ効きます。利益とお金がずれるのは、在庫の増減' + (hard ? '、設備投資と減価償却、借入と返済' : '') + 'など「お金は動いたのに費用にならない（またはその逆）」ものがあるからです。'
  });
  const b = breakEven(last);
  const rate = Math.max(0.05, Math.round(b.marginalRate * 100) / 100);
  const burden = b.burden;
  const bep = money(burden / rate);
  const opts5 = shuffleFixed([man(bep), man(burden), man(money(burden * (1 + rate)))], state.seed + 'q5');
  qs.push({
    tag: 'breakEven', text: `売上に関係なくかかる費用（固定費＋広告費＋廃棄原価）が ${man(burden)}、限界利益率（売上から変動費を引いた割合）が ${Math.round(rate * 100)}% のとき、損益分岐点売上高はおよそいくら？`,
    options: opts5, answer: opts5.indexOf(man(bep)),
    explain: `${man(burden)} ÷ ${Math.round(rate * 100)}% ≒ ${man(bep)}。売上が1万円増えるごとに約${Math.round(rate * 100)}%が利益の増加になるので、この売上でちょうど費用をまかなえます（価格・原価率・人員・広告・廃棄が同じと仮定した近似）。`
  });
  return qs;
}
