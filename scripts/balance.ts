/*
 * 難易度バランスのシミュレーション
 *   npm run balance            （既定 12シード）
 *   npm run balance -- 30      （シード数を指定）
 * すべての戦略を同じシード（同じ乱数条件）で比較する。
 */
import { gameConfig as C } from '../src/config/gameConfig';
import type { DifficultyKey } from '../src/config/gameConfig';
import { playGame } from './bots';

const N = Number(process.argv[2]) || 12;
const seeds = Array.from({ length: N }, (_, i) => 'BAL' + i);
const plans: Record<DifficultyKey, string[]> = {
  easy: ['hold', 'fitOnly', 'basic', 'smart', 'gouge', 'overbuy', 'bigspend'],
  normal: ['hold', 'fitOnly', 'basic', 'smart', 'gouge', 'overbuy', 'bigspend'],
  hard: ['hold', 'fitOnly', 'basic', 'smart', 'smartFridge', 'fitOnlyFridge', 'overbuy', 'overbuyFridge', 'gouge', 'bigspend']
};
const man = (v: number) => (v / 10000).toFixed(0).padStart(6) + '万';
const label: Record<string, string> = {
  hold: '何も変えない', fitOnly: '予測ボタンだけ', basic: '予測＋人員', smart: 'よく考える', smartFridge: 'よく考える＋冷蔵',
  fitOnlyFridge: '予測ボタン＋冷蔵', overbuy: '3割多く仕入れ', overbuyFridge: '3割多く＋冷蔵', gouge: '値上げし続ける', bigspend: '人・広告最大'
};

for (const diff of Object.keys(plans) as DifficultyKey[]) {
  const target = C.difficulties[diff].target;
  console.log(`\n=== ${diff}  目標 ${man(target)}  （${N}シード・全戦略で同じ乱数） ===`);
  console.log('戦略               平均累計OP    最小     最大  達成率 達成  ショート 廃棄率 売逃率  期末資金-借入');
  const base: Record<string, number[]> = {};
  for (const st of plans[diff]) {
    const rs = seeds.map(s => playGame(diff, s, st));
    const ops = rs.map(r => r.cumOP);
    base[st] = ops;
    const avg = ops.reduce((a, b) => a + b, 0) / N;
    const errs = rs.reduce((a, r) => a + r.errors.length, 0);
    const avgOf = (f: (r: typeof rs[number]) => number) => rs.reduce((a, r) => a + f(r), 0) / N;
    console.log(`${(label[st] ?? st).padEnd(14, '　')} ${man(avg)} ${man(Math.min(...ops))} ${man(Math.max(...ops))}  ${(avg / target * 100).toFixed(0).padStart(4)}% ${String(rs.filter(r => r.cumOP >= target).length).padStart(2)}/${N}  ${String(rs.filter(r => r.shortage).length).padStart(3)}   ${(avgOf(r => r.wasteRate) * 100).toFixed(1).padStart(5)}% ${(avgOf(r => r.lostRate) * 100).toFixed(1).padStart(5)}%  ${man(avgOf(r => r.cash - r.loan))}${errs ? '  整合性エラー ' + errs : ''}`);
  }
  // 同じ乱数での一対一比較
  const pair = (a: string, b: string) => {
    if (!base[a] || !base[b]) return;
    const diffs = base[a].map((v, i) => v - base[b][i]);
    const wins = diffs.filter(x => x > 0).length;
    console.log(`  同じシードで比較：${label[a]} − ${label[b]} ＝ 平均 ${man(diffs.reduce((x, y) => x + y, 0) / N)}（${wins}/${N} シードで上回る）`);
  };
  pair('smart', 'fitOnly');
  pair('fitOnly', 'hold');
  pair('smartFridge', 'smart');
  pair('fitOnlyFridge', 'fitOnly');
  pair('overbuyFridge', 'overbuy');
}
