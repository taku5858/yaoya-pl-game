import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { gameConfig as C } from '../config/gameConfig';
import type { DifficultyKey } from '../config/gameConfig';
import type { TurnResult } from '../engine';
import { glossaryFor, man, qty, termById } from '../learning';

export type ModalState =
  | { type: 'term'; term: string }
  | { type: 'glossary' }
  | { type: 'menu' }
  | { type: 'howto' }
  | { type: 'confirm'; title: string; text: string; okLabel: string; onOk: () => void }
  | null;

function Shell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-root">
      <div className="modal-back" onClick={onClose} />
      <div className="modal-box" role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="閉じる">×</button>
        {children}
      </div>
    </div>
  );
}

export function Modal({ modal, onClose, setModal, difficulty, turn, latest, menu }: {
  modal: ModalState; onClose: () => void; setModal: (m: ModalState) => void;
  difficulty: DifficultyKey; turn: number; latest: TurnResult | null;
  menu: { seed: string; canUndo: boolean; onUndo: () => void; onTitle: () => void; onRestart: () => void };
}) {
  if (!modal) return null;
  if (modal.type === 'term') {
    const g = termById(modal.term);
    if (!g) return null;
    return (
      <Shell onClose={onClose}>
        <h2>{g.term}</h2>
        <p className="lead">{g.short}</p>
        <div className="example"><b>今回の数字では</b><p>{latest ? g.example(latest) : '結果が出ると、あなたのお店の数字で例を表示します。'}</p></div>
        <p><button type="button" className="link" onClick={() => setModal({ type: 'glossary' })}>用語集をすべて見る</button></p>
      </Shell>
    );
  }
  if (modal.type === 'glossary') {
    const list = glossaryFor(difficulty, turn);
    return (
      <Shell onClose={onClose}>
        <h2>📖 用語集</h2>
        <p className="small muted">年が進むと新しい用語が解放されます。{latest && '例はあなたの最新の結果の数字です。'}</p>
        <div className="glossary">
          {list.map(g => g.unlocked
            ? <details key={g.id}><summary>{g.term}</summary><p>{g.short}</p>{latest && <p className="example small">例：{g.example(latest)}</p>}</details>
            : <div key={g.id} className="locked">🔒 {g.term} <small>{g.stage + 1}年目で解放</small></div>)}
        </div>
      </Shell>
    );
  }
  if (modal.type === 'menu') {
    const d = C.difficulties[difficulty];
    return (
      <Shell onClose={onClose}>
        <h2>メニュー</h2>
        <p className="small">難易度：{d.emoji}{d.name}　シード：<code>{menu.seed}</code></p>
        <p className="small muted">進み具合はこのブラウザの中（localStorage）だけに自動で保存されます。サーバーには送りません。</p>
        <div className="menu-btns">
          <button type="button" className="btn" onClick={() => setModal({ type: 'glossary' })}>📖 用語集</button>
          <button type="button" className="btn" onClick={() => setModal({ type: 'howto' })}>❓ 遊び方とルール</button>
          {menu.canUndo && <button type="button" className="btn" onClick={menu.onUndo}>↩ 1ターン戻す</button>}
          <button type="button" className="btn" onClick={menu.onTitle}>🏠 タイトルへ</button>
          <button type="button" className="btn danger" onClick={menu.onRestart}>🔄 最初からやり直す</button>
        </div>
      </Shell>
    );
  }
  if (modal.type === 'howto') {
    return (
      <Shell onClose={onClose}>
        <h2>❓ 遊び方とルール</h2>
        <h3>1期の中の流れ（13週）</h3>
        <p>毎週はじめに、決めた数だけ野菜が入荷します（代金はその週に支払い）。その週の需要の範囲で、古い野菜から売れます（売上はその週に入金）。週の終わりに、売れる期間を過ぎた売れ残りは廃棄します。</p>
        <h3>需要と販売</h3>
        <p>需要＝基準の需要×季節×価格の影響×広告×（予測の誤差・週ごとのばらつき）。価格を標準より10%上げると、需要はおよそ20〜25%減ります。販売数は「需要」「売れる在庫」「販売できる上限（人員×週{qty(C.staff.capacityPerWeek)}）」のいちばん小さいところで決まります。</p>
        <h3>在庫と廃棄</h3>
        <p>売れる期間：トマト1週、キャベツ2週、にんじん4週（冷蔵設備でトマト・キャベツ+1週、にんじん+2週）。期末に持ち越せるのは、まだ売れる期間が残っている分だけ。在庫は仕入れ値で数え、売れた分・捨てた分の原価だけが売上原価（費用）になります。</p>
        <h3>PL</h3>
        <p>売上高 − 売上原価 ＝ 粗利、粗利 − 販管費（人件費・家賃・広告費・水道光熱費・減価償却費）＝ 営業利益（お店の本業でもうかった金額）。むずかしいでは支払利息を引いた経常利益も表示します。税金などは省略しています。</p>
        <h3>お金</h3>
        <p>家賃・設備代金・返済は期首、仕入れは毎週、人件費・水道光熱費・広告費・利息は期末に支払います。期の途中で一度でも手元資金がマイナスになると資金ショートで、その期か1つ前からやり直せます。</p>
        <h3>端数</h3>
        <p>金額はすべて千円単位に四捨五入して計算し、万円（小数1桁）で表示しています。例：{man(1234000)}。</p>
      </Shell>
    );
  }
  return (
    <Shell onClose={onClose}>
      <h2>{modal.title}</h2>
      <p>{modal.text}</p>
      <div className="actions"><button type="button" className="btn ghost" onClick={onClose}>やめる</button><button type="button" className="btn danger" onClick={modal.onOk}>{modal.okLabel}</button></div>
    </Shell>
  );
}
