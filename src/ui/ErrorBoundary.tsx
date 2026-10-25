import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { backupInvalidSave, deleteSave } from '../save/saveData';

/** 予期しないエラーで画面全体が真っ白にならないようにする。セーブデータは本人の操作なしに消さない。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // 開発時の確認用（個人情報は扱っていない）
    console.error(error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app">
        <section className="card narrow notice-bad" role="alert">
          <h2>表示中にエラーが起きました</h2>
          <p>ページを再読み込みしてみてください。直らない場合は、セーブデータを退避してから新しく始められます。</p>
          <div className="actions wrap">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>再読み込み</button>
            <button type="button" className="btn danger" onClick={() => { backupInvalidSave(); deleteSave(); window.location.reload(); }}>セーブを退避して新しく始める</button>
          </div>
        </section>
      </div>
    );
  }
}
