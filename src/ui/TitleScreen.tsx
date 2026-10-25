import { useState } from 'react';
import { gameConfig as C } from '../config/gameConfig';
import type { DifficultyConfig, DifficultyKey } from '../config/gameConfig';
import { sanitizeSeed } from '../engine';
import { man, turnLabel } from '../learning';
import type { LoadResult } from '../save/saveData';
import { M } from './common';

const features = (d: DifficultyConfig) => [
  '価格', '仕入れ', '人員',
  d.features.ad ? '広告' : null,
  d.features.fridge ? '冷蔵設備・減価償却' : null,
  d.features.loan ? '借入・経常利益' : null,
  d.seasonal ? '季節変動' : '需要が安定',
  d.preview ? '予想PLつき' : null
].filter((x): x is string => !!x);

export function TitleScreen({ load, initialDiff, initialSeed, onStart, onContinue }: {
  load: LoadResult; initialDiff: DifficultyKey; initialSeed: string;
  onStart: (d: DifficultyKey, seed: string) => void; onContinue: () => void;
}) {
  const [diff, setDiff] = useState<DifficultyKey>(initialDiff);
  const [seed, setSeed] = useState(initialSeed);
  const saved = load.status === 'ok' ? load.session : null;
  return (
    <div className="title-screen">
      <header className="hero">
        <div className="hero-veg" aria-hidden="true">🍅 🥬 🥕</div>
        <h1>八百屋さんで学ぶ<br /><span>PL経営</span></h1>
        <p>店長になって5年間（20期）お店を切り盛りしながら、損益計算書（PL）の読み方を身につけましょう。</p>
      </header>
      {saved && (
        <section className="card continue">
          <div><b>つづきから</b><p>{C.difficulties[saved.core.difficulty].name}・{saved.phase === 'finished' ? '5年間終了' : turnLabel(Math.min(saved.core.turn, C.totalTurns - 1))}・累計営業利益 <M v={saved.core.cumOP} /></p></div>
          <button type="button" className="btn primary" onClick={onContinue}>つづきから遊ぶ</button>
        </section>
      )}
      {load.status === 'invalid' && (
        <section className="card notice-bad" role="alert">
          <b>セーブデータを読み込めませんでした</b>
          <p className="small">理由：{load.reason}。データは消していません。新しく始めると、読み込めなかったデータは別の名前（{C.saveBackupKey}）に退避してから上書きします。</p>
        </section>
      )}
      <section className="card">
        <h2>難易度をえらぶ</h2>
        <div className="diff-grid">
          {Object.values(C.difficulties).map(d => (
            <button key={d.key} type="button" className={'diff-card' + (diff === d.key ? ' selected' : '')} aria-pressed={diff === d.key} onClick={() => setDiff(d.key)}>
              <span className="diff-name">{d.emoji} {d.name}</span>
              <span className="diff-target">目標：5年間の累計営業利益 <b>{man(d.target)}</b></span>
              <span className="diff-sum">{d.summary}</span>
              <span className="chips">{features(d).map(f => <i key={f}>{f}</i>)}</span>
            </button>
          ))}
        </div>
        <details className="adv">
          <summary>くわしい設定（乱数シード）</summary>
          <label className="field">シード（英数字・20文字まで）
            <input type="text" value={seed} maxLength={20} autoComplete="off" placeholder="空欄ならランダム" onChange={e => setSeed(sanitizeSeed(e.target.value))} />
          </label>
          <p className="small muted">同じシード・同じ判断なら、まったく同じ結果になります。</p>
        </details>
        <button type="button" className="btn primary big wide" onClick={() => onStart(diff, seed)}>{saved ? '新しくお店をひらく' : 'お店をひらく'}</button>
        {saved && <p className="small muted center">※新しく始めると、いまのセーブデータは上書きされます（確認があります）。</p>}
      </section>
      <section className="card how">
        <h2>遊び方</h2>
        <ol className="howto">
          <li><b>状況を見る</b>：季節、需要の予測、仕入れ値、在庫を確認</li>
          <li><b>経営判断</b>：販売価格・毎週の仕入れ数量・人員（＋広告など）を決める</li>
          <li><b>結果を予想</b>：「利益は増える？減る？」などに答える</li>
          <li><b>経営結果</b>：販売数・売れ残り・欠品・PL・手元資金を確認</li>
          <li><b>理由を学ぶ</b>：なぜ利益が変わったかを、実際の数字で解説</li>
          <li><b>次の期へ</b>：1期＝3か月（13週）。20期（5年）で終了し、成績と理解度を別々に評価</li>
        </ol>
        <div className="pl-mini">
          <div>売上高</div><div className="op">−</div><div>売上原価</div><div className="op">＝</div><div className="hl">粗利</div><div className="op">−</div><div>販管費</div><div className="op">＝</div><div className="hl">営業利益<small>本業のもうけ</small></div>
        </div>
        <p className="small muted">金額はすべて「万円」（小数1桁）で表示します。マイナスは「−」と赤字で示します。税金などは省略しています。ログインや個人情報の入力はありません。進み具合はこのブラウザの中だけに保存されます。</p>
      </section>
    </div>
  );
}
