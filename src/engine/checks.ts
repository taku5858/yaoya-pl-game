import { gameConfig as C } from '../config/gameConfig';
import { isMoneyUnit } from './money';
import type { TurnResult } from './types';

/**
 * 1ターンの結果の整合性チェック。問題がなければ空配列。テストと開発時の確認に使う。
 */
export function checkResult(r: TurnResult): string[] {
  const errs: string[] = [];
  const eq = (a: number, b: number, msg: string) => { if (a !== b) errs.push(`${msg}: ${a} != ${b}`); };
  const pl = r.pl;
  eq(pl.cogs, pl.cogsSold + pl.cogsWaste, '売上原価＝販売分の原価＋廃棄原価');
  eq(pl.grossProfit, pl.revenue - pl.cogs, '粗利＝売上高−売上原価');
  eq(pl.sga, pl.labor + pl.rent + pl.utilities + pl.advertising + pl.depreciation, '販管費の内訳');
  eq(pl.operatingProfit, pl.grossProfit - pl.sga, '営業利益＝粗利−販管費');
  eq(pl.ordinaryProfit, pl.operatingProfit - pl.interest, '経常利益＝営業利益−支払利息');
  const inv = r.inventory;
  eq(inv.begin + inv.purchases, inv.cogsSold + inv.cogsWaste + inv.end, '期首在庫＋仕入＝販売分の原価＋廃棄原価＋期末在庫');
  eq(pl.revenue, r.rows.reduce((s, x) => s + x.revenue, 0), '売上高＝商品別の合計');
  for (const x of r.rows) {
    eq(x.beginQty + x.purchaseQty, x.sold + x.waste + x.carry, `${x.name} 数量：期首＋仕入＝販売＋廃棄＋期末`);
    eq(x.beginValue + x.purchaseCost, x.soldCost + x.wasteCost + x.endValue, `${x.name} 金額：期首＋仕入＝販売分＋廃棄分＋期末`);
    eq(x.demand, x.sold + x.stockout + x.capacityLost, `${x.name} 需要＝販売＋欠品＋人手不足`);
    eq(x.purchaseQty, x.orderPerWeek * C.weeksPerTurn, `${x.name} 仕入れ数＝週の仕入れ×13`);
    if (x.sold > x.availQty) errs.push(`${x.name} 販売数が在庫を超過`);
    if (x.sold > x.demand) errs.push(`${x.name} 販売数が需要を超過`);
    if ([x.sold, x.waste, x.carry, x.soldCost, x.wasteCost, x.endValue].some(v => v < 0)) errs.push(`${x.name} 負の値`);
    if (x.carry === 0 && x.endValue !== 0) errs.push(`${x.name} 数量0なのに在庫金額あり`);
    if (x.waste === 0 && x.wasteCost !== 0) errs.push(`${x.name} 廃棄0なのに廃棄原価あり`);
    if (x.sold === 0 && x.revenue !== 0) errs.push(`${x.name} 販売0なのに売上あり`);
    // 週ごと：販売数は在庫と能力を超えない
    x.weeks.forEach((w, i) => { if (w.sold > w.demand) errs.push(`${x.name} ${i + 1}週 販売>需要`); });
    // 持ち越した在庫は、まだ売れる期間が残っているものだけ
    for (const l of r.endInventory[x.id as keyof typeof r.endInventory]) {
      if (l.weeksLeft <= 0 || l.weeksLeft > x.shelfWeeks) errs.push(`${x.name} 持ち越しロットの残り週数が不正 ${l.weeksLeft}`);
      if (l.qty <= 0) errs.push(`${x.name} 空のロットを持ち越し`);
    }
  }
  for (let w = 0; w < C.weeksPerTurn; w++) {
    const soldW = r.rows.reduce((s, x) => s + x.weeks[w].sold, 0);
    if (soldW > r.capacityPerWeek) errs.push(`${w + 1}週 販売数が販売能力を超過`);
  }
  const c = r.cash;
  eq(c.end, c.begin + c.revenueIn - c.purchasesOut - c.expensesOut - c.interestOut - c.capexOut + c.borrow - c.repay, '資金の増減');
  // 利益→資金：資金増減＝営業利益＋減価償却費−在庫の増加−設備投資＋借入−返済−支払利息
  eq(c.change, pl.operatingProfit + pl.depreciation - (inv.end - inv.begin) - c.capexOut + c.borrow - c.repay - pl.interest, '利益と資金のつながり');
  if (c.min > c.end) errs.push('期中の最低資金が期末資金より大きい');
  if (r.shortage !== (c.min < 0)) errs.push('資金ショート判定の不一致');
  for (const [k, v] of Object.entries(pl)) if (!isMoneyUnit(v)) errs.push(`${k} が千円単位でない: ${v}`);
  if (r.fridge.bookEnd < 0) errs.push('設備の帳簿価額がマイナス');
  return errs;
}
