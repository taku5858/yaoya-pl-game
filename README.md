# 八百屋さんで学ぶPL経営

八百屋の店長として5年間（1期＝3か月 × 20期）お店を経営しながら、損益計算書（PL）のしくみを学ぶブラウザゲームです。会計初心者向け。ログイン・個人情報の入力・外部API・アクセス解析はありません。

- 判断：販売価格、毎週の仕入れ数量、人員（ふつう以上で広告、むずかしいで冷蔵設備・借入）
- 1期の中を週ごとに計算し、野菜の鮮度（売れる期間）・廃棄・持ち越し在庫を矛盾なく扱います
- 毎期「結果を予想→結果→理由を学ぶ」。解説は実際の数字から作り、PLと一致します
- 5年後に「経営成績」と「PL理解度」を別々に評価します

## 必要な環境
- Node.js 20 以上（開発・確認は Node.js 24 で実施）と npm
- ブラウザ：最近の Chrome / Edge / Safari / Firefox（PC・スマートフォン）
- `npm run e2e` を使う場合のみ：Google Chrome または Microsoft Edge（Node.js 22 以上）

## 公開URL（GitHub Pages）
- https://taku5858.github.io/yaoya-pl-game/ （公開前。リポジトリを公開して GitHub Pages を有効にするまで開けません。状況は `docs/progress.md`）
- URL を知っている人なら誰でも、ログインなしで遊べます。検索エンジンに載る可能性もあります。
- セーブデータは遊ぶ人それぞれのブラウザ（`localStorage`）に保存され、サーバーには送られません。URL（ドメイン）が変わると以前のセーブは引き継がれません（`localhost` で遊んだデータも公開サイトには移りません）。

## インストールと起動（自分のPCで遊ぶ・開発する）
```bash
npm install          # 依存パッケージ（package-lock.json どおり）
npm run dev          # 開発サーバー（表示された http://localhost:5173 を開く。自分のPCでだけ開けます）
```

## 更新を公開する手順
1. 変更後に `npm run check`（必要なら `npm run e2e`）がすべて成功することを確認する
2. 変更をコミットして `main` ブランチに push する（push では型チェック・テスト・ビルドだけが動き、公開はされない）
3. GitHub の Actions タブ →「Deploy to GitHub Pages」→「Run workflow」で手動実行する。チェックが成功すれば、数分で公開URLに反映される

ワークフロー（`.github/workflows/pages.yml`）は、ロックファイルどおりのインストール → 型チェック → テスト → ビルドがすべて成功したときだけ公開します。公開は手動実行のときだけで、プルリクエストでは動きません。公開後の通しプレイ確認は `E2E_URL=https://taku5858.github.io/yaoya-pl-game/ npm run e2e` で実行できます。

## テストとビルド
```bash
npm run check        # 型チェック → テスト → ビルド をまとめて実行
npm test             # テストのみ（Vitest）
npm run build        # dist/ に静的ファイルを出力
npm run preview      # ビルド結果をローカルで確認
npm run e2e          # ヘッドレスChromeで PC/スマホ幅の通しプレイ確認（先に build）
npm run balance      # 難易度バランスのシミュレーション（npm run balance -- 30 でシード数指定）
```
`dist/` は静的ファイルなので、任意の静的ホスティングに置けます（公開前の確認事項は `docs/security.md`）。本番ビルドの `index.html` には Content-Security-Policy の meta タグが入ります（`vite.config.ts`）。ビルド結果は `file://` で直接開くとブラウザの制限で動かないため、`npm run preview` などのサーバー経由で開いてください。

## セーブデータ
- 保存先：このブラウザの `localStorage`（キー `yaoya-pl-save-v2`）。サーバーには送りません。
- 保存されるのはシード・難易度・各期の判断・予想の選択などだけで、結果は読み込み時に再計算します。
- 読み込めなかったデータは消さずに残し、新しく始めるときに `yaoya-pl-save-v2-backup` に退避します。
- リセット方法：ゲーム内の「メニュー → 最初からやり直す」（同じシードで1年目から）、またはタイトルで新しく始める。データ自体を消す場合は、ブラウザの開発者ツールで `localStorage` の上記キーを削除するか、サイトデータを削除してください。
- 乱数シード：タイトルの「くわしい設定」か、URL の `?seed=ABC123&difficulty=hard` で指定できます。

## ファイル構成
```
src/config/      設定データ（難易度・目標値・商品・費用）
src/engine/      計算ロジック（週次シミュレーション・在庫・PL・資金・整合性チェック）
src/learning/    用語集・解説文・予想問題・損益分岐点・評価
src/save/        セッション操作とセーブデータの検証・復元
src/ui/          React の画面とスタイル
tests/           Vitest（会計・在庫・資金・セーブ・5年間の進行・解説・バランス）
scripts/         バランス集計、ブラウザ通しプレイ確認
docs/            仕様書
```

## 仕様ファイル
- `docs/game-design.md` — ゲーム設計（目的・流れ・難易度・画面・評価・今後の追加）
- `docs/accounting-rules.md` — 会計モデル（式と数値例）
- `docs/learning-design.md` — 学習設計（段階解放・予想問題・振り返り・誤解しやすい点）
- `docs/security.md` — 安全対策と公開時の確認事項
- `docs/implementation-plan.md` — 実装計画
- `docs/progress.md` — 進捗・検証結果・残課題
- `CLAUDE.md` — 開発ルール（Claude Code 用）
