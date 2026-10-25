import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 本番ビルドの index.html にだけ Content-Security-Policy を入れる（GitHub Pages はヘッダーを設定できないため meta で指定）。
// 開発サーバーはインラインスクリプトを使うので対象外。style-src の 'unsafe-inline' は React の style 属性、img-src の data: はファビコン用。
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const cspMeta = (): Plugin => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }]
});

// base: './' にして、ビルド成果物をどのフォルダに置いても動くようにする
// （GitHub Pages の https://<ユーザー>.github.io/<リポジトリ名>/ でも、リポジトリ名に依存せずパスが壊れない）
export default defineConfig({
  base: './',
  plugins: [react(), cspMeta()],
  build: { outDir: 'dist', sourcemap: false },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
});
