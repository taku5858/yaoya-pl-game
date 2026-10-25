/*
 * ブラウザでの通しプレイ確認（ヘッドレス Chrome / Edge を DevTools Protocol で操作）
 *   npm run build && npm run e2e [-- 出力フォルダ]
 *   公開済みサイトを確認する場合：E2E_URL=https://taku5858.github.io/yaoya-pl-game/ npm run e2e
 * PC幅（1280px）とスマホ幅（390px）で3難易度を20ターン遊び、次を確認してスクリーンショットを保存する。
 *  - JSエラーがない、横にはみ出さない、5年間→理解度テスト→最終評価まで進める
 *  - 結果画面の数字の一致（解説文・内訳バーの合計・PL表・在庫の式・利益→資金）
 *  - 比較・1ターン戻す・用語の説明・再読み込みでの再開・壊れたセーブでも起動できる
 * 実機のスマートフォンでの確認ではない（画面幅とタッチ相当のクリックを模擬しているだけ）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'yaoya-e2e'));
fs.mkdirSync(OUT, { recursive: true });
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
if (!CHROME) { console.log('Chrome が見つからないため、確認をスキップしました（CHROME_PATH で指定できます）'); process.exit(0); }
// E2E_URL を指定すると、ローカルの preview の代わりに公開済みサイトを確認する（例：E2E_URL=https://taku5858.github.io/yaoya-pl-game/）
const REMOTE = process.env.E2E_URL ? process.env.E2E_URL.replace(/\/?$/, '/') : '';
if (!REMOTE && !fs.existsSync(path.join(root, 'dist', 'index.html'))) { console.log('先に npm run build を実行してください'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const WEB_PORT = 4300 + Math.floor(Math.random() * 400);
const CDP_PORT = 9400 + Math.floor(Math.random() * 400);
const BASE = REMOTE || `http://127.0.0.1:${WEB_PORT}/`;

async function main() {
  const server = REMOTE ? null : spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'yaoya-prof-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill(); } catch {} try { server?.kill(); } catch {} };
  let targets = [];
  for (let i = 0; i < 60 && !targets.length; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).filter(t => t.type === 'page'); } catch {} await sleep(200); }
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await sleep(200); }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const jsErrors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') jsErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval error');
    return r.result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  // ページ内で使う補助関数
  const helpers = `
    window.__t = {
      btn(text, scope) { const root = scope ? document.querySelector(scope) : document; if (!root) return null; return [...root.querySelectorAll('button, summary')].find(b => !b.disabled && b.textContent.replace(/\\s+/g,' ').includes(text)) || null; },
      click(text, scope) { const b = this.btn(text, scope); if (b) b.click(); return !!b; },
      aria(label, scope) { const root = scope ? document.querySelector(scope) : document; const b = root && root.querySelector('[aria-label="' + label + '"]'); if (b) b.click(); return !!b; },
      num(s) { const m = String(s).replace(/,/g,'').match(/([−+±-]?)(\\d+(?:\\.\\d+)?)万円/); if (!m) return null; const v = Math.round(parseFloat(m[2]) * 10); return m[1] === '−' || m[1] === '-' ? -v : v; },
      plRow(label) { const row = [...document.querySelectorAll('.result-layout .pl-table tbody tr')].find(tr => tr.querySelector('th').textContent.replace(/（.*?）/g,'').trim().endsWith(label)); return row ? [...row.querySelectorAll('td')].map(td => td.textContent) : null; },
      checkResult() {
        const errs = [];
        const t = this;
        const op = t.plRow('営業利益');
        if (!op) return ['PL表がない'];
        const kpi = document.querySelector('.kpi.main b');
        if (t.num(kpi.textContent) !== t.num(op[0])) errs.push('KPIの営業利益とPL表が不一致');
        if (op[2] && op[2] !== '—') {
          const delta = t.num(op[2]);
          const total = document.querySelector('.drv.total .drv-val');
          if (total && t.num(total.textContent) !== delta) errs.push('内訳バーの合計とPLの増減が不一致 ' + total.textContent + ' / ' + op[2]);
          const sum = [...document.querySelectorAll('.drv:not(.total) .drv-val')].reduce((a, e) => a + t.num(e.textContent), 0);
          if (sum !== delta) errs.push('内訳バーの和とPLの増減が不一致');
          const summary = document.querySelector('.summary').textContent;
          if (delta !== 0 && !summary.includes('営業利益は ' + op[2].replace(/^[+−±]/, ''))) errs.push('解説文の営業利益の増減がPLと不一致: ' + summary);
          const rev = t.plRow('売上高');
          if (rev && rev[2] !== '±0.0万円' && !summary.includes(rev[2].replace(/^[+−±]/, ''))) errs.push('解説文の売上の増減がPLと不一致');
        }
        const inv = [...document.querySelectorAll('.inv-eq .box b')].map(b => t.num(b.textContent));
        if (inv.length === 5 && inv[0] + inv[1] !== inv[2] + inv[3] + inv[4]) errs.push('在庫の式が不一致');
        const cogs = t.plRow('売上原価');
        if (cogs && t.num(cogs[0]) !== inv[2] + inv[3]) errs.push('売上原価と在庫の式が不一致');
        const bridge = [...document.querySelectorAll('.col-side .bridge')][0];
        if (bridge) {
          const rows = [...bridge.querySelectorAll('tr')];
          let acc = 0;
          for (const tr of rows) { const th = tr.querySelector('th').textContent.trim(); if (tr.classList.contains('total')) { if (acc !== t.num(tr.querySelector('td').textContent)) errs.push('利益→資金の説明が不一致'); break; } const v = t.num(tr.querySelector('td').textContent); acc += th.startsWith('−') ? -Math.abs(v) : th.startsWith('＋') ? Math.abs(v) : v; }
          if (t.num(rows[0].querySelector('td').textContent) !== t.num(op[0])) errs.push('資金の説明の営業利益がPLと不一致');
        }
        if (/undefined|NaN/.test(document.body.innerText)) errs.push('undefined/NaN が表示されている');
        return errs;
      }
    };`;
  const page = async () => { await ev(helpers); };
  const click = (text, scope) => ev(`__t.click(${JSON.stringify(text)}, ${JSON.stringify(scope ?? null)})`);
  const aria = (label, scope) => ev(`__t.aria(${JSON.stringify(label)}, ${JSON.stringify(scope ?? null)})`);
  const has = text => ev(`document.body.innerText.includes(${JSON.stringify(text)})`);
  const overflow = w => ev(`Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - ${w}`);
  const step = async () => { await sleep(40); await page(); };
  async function shot(name) {
    const m = await send('Page.getLayoutMetrics');
    const cs = m.result.cssContentSize || m.result.contentSize;
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: cs.width, height: Math.min(cs.height, 7000), scale: 1 } });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
  }
  const go = async q => { await send('Page.navigate', { url: BASE + q }); await sleep(700); await page(); };

  const report = [];
  const consistency = [];
  for (const vp of [{ name: 'pc', w: 1280, h: 900, mobile: false }, { name: 'sp', w: 390, h: 844, mobile: true }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
    for (const diff of ['easy', 'normal', 'hard']) {
      await go(`?seed=E2E${diff.toUpperCase()}&difficulty=${diff}`);
      await ev('localStorage.clear()');
      await go(`?seed=E2E${diff.toUpperCase()}&difficulty=${diff}`);
      if (diff === 'normal') await shot(`${vp.name}-00-title`);
      await click('お店をひらく'); await step();
      let maxOverflow = await overflow(vp.w);
      const seen = new Set();
      let shortages = 0;
      for (let t = 0; t < 20; t++) {
        await click('わかった'); await step();
        if (t === 0 && diff !== 'easy') { await click('ヒントを見る'); await step(); }
        if (diff === 'hard' && t === 1) {
          await aria('借入を増やす'); await step();
          await ev(`(() => { const c = document.querySelector('.check input'); if (c && !c.checked) c.click(); })()`); await step();
        }
        if (diff !== 'easy' && t % 4 === 1) { await ev(`(() => { const b = [...document.querySelectorAll('.seg-btns button')].find(b => b.textContent.startsWith('10万円')); b && b.click(); })()`); await step(); }
        await click('3品目とも需要予測に合わせて仕入れる'); await step();
        if ([0, 5, 9, 13].includes(t)) await shot(`${vp.name}-${diff}-t${String(t + 1).padStart(2, '0')}-decide`);
        maxOverflow = Math.max(maxOverflow, await overflow(vp.w));
        await click('判断を決定して'); await step();
        if (t === 0) await shot(`${vp.name}-${diff}-t01-predict`);
        await ev(`document.querySelector('.choice').click()`); await step();
        await click('結果を見る'); await step();
        if (await has('資金ショート！')) {
          shortages++; seen.add('shortage');
          await shot(`${vp.name}-${diff}-shortage`);
          await click('この期の判断をやり直す'); await step();
          if (diff === 'hard') { await aria('借入を増やす'); await aria('借入を増やす'); await step(); }
          await click('判断を決定して'); await step();
          await ev(`document.querySelector('.choice').click()`); await step();
          await click('結果を見る'); await step();
        }
        const errs = await ev('__t.checkResult()');
        if (errs.length) consistency.push({ vp: vp.name, diff, turn: t + 1, errs });
        maxOverflow = Math.max(maxOverflow, await overflow(vp.w));
        if ([0, 9, 14].includes(t)) await shot(`${vp.name}-${diff}-t${String(t + 1).padStart(2, '0')}-result`);
        if (t === 2) {
          await click('別の判断と比べる'); await step();
          await aria('人員を増やす', '.compare-card'); await step();
          await click('この判断で計算する'); await step();
          if (await ev(`!!document.querySelector('.compare-card .pl-table')`)) seen.add('compare');
          if (diff === 'normal') await shot(`${vp.name}-${diff}-compare`);
          maxOverflow = Math.max(maxOverflow, await overflow(vp.w));
        }
        if (diff === 'easy' && t === 3) {
          await click('1ターン戻してやり直す'); await step();
          await click('判断を決定して'); await step();
          await ev(`document.querySelector('.choice').click()`); await step();
          await click('結果を見る'); await step();
          if (await has('やり直し前との比較')) seen.add('undo-compare');
        }
        if (t === 4) {
          await ev(`[...document.querySelectorAll('.term')].find(b => b.textContent.includes('粗利')).click()`); await step();
          if (await ev(`!!document.querySelector('.modal-box .example')`)) seen.add('term-modal');
          if (diff === 'normal') await shot(`${vp.name}-term-modal`);
          await aria('閉じる'); await step();
        }
        if (t === 9 && await has('費用の2つの見方')) seen.add('cost-view');
        if (t === 13 && await has('損益分岐点（初心者向けの近似）')) seen.add('bep');
        if (diff === 'hard' && t === 5 && await has('冷蔵設備の効果（今期）')) seen.add('fridge-effect');
        if (t < 19) { await click('次の期へ進む'); await step(); }
      }
      await click('理解度テストへ'); await step();
      for (let i = 0; i < 5; i++) {
        await ev(`[...document.querySelectorAll('.choice')].find(b => !b.disabled).click()`); await step();
        if (i === 0 && diff === 'normal') await shot(`${vp.name}-quiz`);
        await click(i < 4 ? '次の問題へ' : '成績を見る'); await step();
      }
      const finished = await has('5年間、おつかれさまでした');
      await shot(`${vp.name}-${diff}-finished`);
      maxOverflow = Math.max(maxOverflow, await overflow(vp.w));
      await go('');
      const resumed = await has('5年間、おつかれさまでした');
      report.push({ vp: vp.name, diff, finished, resumed, maxOverflow, shortages, seen: [...seen].sort().join(',') });
    }
  }
  // 壊れたセーブデータでも起動できる
  await ev(`localStorage.setItem('yaoya-pl-save-v2', '{broken json')`);
  await go('');
  const brokenOk = await has('セーブデータを読み込めませんでした');
  const brokenKept = await ev(`localStorage.getItem('yaoya-pl-save-v2') === '{broken json'`);
  await click('お店をひらく'); await step(); await click('新しく始める'); await step();
  const backedUp = await ev(`localStorage.getItem('yaoya-pl-save-v2-backup') === '{broken json'`);
  const startedAfterBroken = await has('今期の状況');

  console.table(report);
  console.log('数字の一致チェック:', consistency.length ? JSON.stringify(consistency, null, 1) : 'すべて一致');
  console.log('壊れたセーブ:', { 表示: brokenOk, 消さずに保持: brokenKept, 退避: backedUp, 新規開始: startedAfterBroken });
  console.log('JSエラー:', jsErrors.length ? jsErrors : 'なし');
  console.log('スクリーンショット:', OUT);
  ws.close(); cleanup();
  const bad = jsErrors.length || consistency.length || !brokenOk || !brokenKept || !backedUp || !startedAfterBroken ||
    report.some(r => !r.finished || !r.resumed || r.maxOverflow > 0);
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
