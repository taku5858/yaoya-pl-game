/*
 * 難易度バランスの最低限の確認（詳しくは npm run balance）。
 * 全戦略を同じシード（同じ乱数）で比較する。
 */
import { describe, expect, it } from 'vitest';
import { gameConfig as C } from '../src/config/gameConfig';
import { playGame } from '../scripts/bots';

const seeds = ['BT0', 'BT1'];
const avg = (diff: 'easy' | 'normal' | 'hard', st: string) => seeds.map(s => playGame(diff, s, st)).reduce((a, r) => a + r.cumOP, 0) / seeds.length;

describe('難易度バランス', () => {
  for (const diff of ['easy', 'normal', 'hard'] as const) {
    it(`${diff}: よく考えるプレイは目標に届き、単純な戦略は勝てない`, () => {
      const target = C.difficulties[diff].target;
      const smart = avg(diff, 'smart');
      expect(smart).toBeGreaterThanOrEqual(target);
      expect(avg(diff, 'gouge')).toBeLessThan(target * 0.5);
      expect(avg(diff, 'overbuy')).toBeLessThan(target * 0.5);
      if (diff !== 'easy') {
        // 「需要予測に合わせる」ボタンだけでは目標に届かない（同じ乱数で比較）
        const fit = avg(diff, 'fitOnly');
        expect(fit).toBeLessThan(target);
        expect(smart - fit).toBeGreaterThan(1000000);
      }
    }, 180000);
  }
});
