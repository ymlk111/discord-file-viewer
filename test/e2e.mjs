// ローカル結合テスト: wrangler dev を起動し、Discord をまねたリクエストで一通りの流れを確認する
//   npm test            テストして終了
//   npm test -- --keep  テスト後もサーバーを起動したままにする（ブラウザで表示確認したいとき）

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';

const WORKER_PORT = 8789;
const MOCK_PORT = 8790;
const W = `http://127.0.0.1:${WORKER_PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const keep = process.argv.includes('--keep');

// ---- テスト用の鍵（Discord の代わりに署名する） ----
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubHex = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');

// ---- 添付ファイルの代わり ----
const MD = `---
title: 仕様メモ
tags: [discord, viewer]
---

# 要件定義（サンプル）

iPhone の Discord から **Markdown** を整形して読むためのテストです。<script>alert('xss')</script>

## 機能一覧

| No | 機能 | 説明 | 優先度 | 担当 | 備考 |
|---:|------|------|:------:|------|------|
| 1 | ビューワー | md / html / テキストを表示 | 高 | TF | 横に長い表はスクロール |
| 2 | 目次 | 見出しから目次を作る | 中 | TF | 見出し3つ以上で表示 |

- [x] 署名検証
- [ ] 永続化

## コード

\`\`\`js
export default { fetch: () => new Response('hello') };
\`\`\`

\`\`\`powershell
Get-ChildItem -Path C:\\logs -Filter *.log | Select-Object -First 5
\`\`\`

## 図

\`\`\`mermaid
flowchart LR
  A[メッセージ長押し] --> B[ビューワーで開く]
  B --> C{対応形式?}
  C -->|はい| D[リンクを返す]
  C -->|いいえ| E[エラー表示]
\`\`\`

> 引用ブロックも表示できます。[外部リンク](https://example.com) と [内部リンク](#コード)

### 小見出し

おわり。
`;

const HTML = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>テストページ</title>
<style>body{font-family:sans-serif;margin:0;padding:24px;background:linear-gradient(135deg,#6366f1,#ec4899);color:#fff;min-height:100vh}
.card{background:rgba(255,255,255,.15);border-radius:16px;padding:20px}</style></head>
<body><div class="card"><h1>HTMLテスト</h1><p id="out">script not run</p><p id="storage"></p></div>
<script>
document.getElementById('out').textContent = 'JavaScript: OK';
localStorage.setItem('count', String(Number(localStorage.getItem('count') || 0) + 1));
document.getElementById('storage').textContent = 'localStorage: ' + localStorage.getItem('count');
try { document.getElementById('storage').textContent += ' / parent: ' + (window.parent.document ? 'reachable(NG)' : '?'); }
catch (e) { document.getElementById('storage').textContent += ' / parent: blocked(OK)'; }
</script></body></html>`;

const fixtures = {
  'spec.md': Buffer.from(MD),
  // "# こんにちは\n\nシフトJISのテスト: 表示できていればOK\n" を Shift_JIS で
  'sjis.md': Buffer.from('232082b182f182c982bf82cd0a0a8356837483674a495382cc8365835883673a20955c8ea682c582ab82c482a282ea82ce4f4b0a', 'hex'),
  'page.html': Buffer.from(HTML),
  'collect.ps1': Buffer.from('# ログ収集\n$files = Get-ChildItem -Path "C:\\logs" -Filter *.log\nforeach ($f in $files) {\n  Write-Host "$($f.Name): $($f.Length) bytes"\n}\n'),
  'data.json': Buffer.from('{"name":"viewer","features":["md","html","text"],"nested":{"ok":true,"count":3}}'),
  'photo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  'huge.md': Buffer.from('# big'),
};

const att = (filename, extra = {}) => ({
  id: `a-${filename}`,
  filename,
  size: fixtures[filename].length,
  url: `${MOCK}/files/${encodeURIComponent(filename)}?ex=1&is=2&hm=3`,
  ...extra,
});

// ---- Discord API と CDN のモック ----
const edits = new Map();
let registered = null;
const mock = createServer((req, res) => {
  const url = new URL(req.url, MOCK);
  const file = url.pathname.match(/^\/files\/(.+)$/);
  if (req.method === 'GET' && file) {
    const data = fixtures[decodeURIComponent(file[1])];
    if (!data) return res.writeHead(404).end();
    return res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(data);
  }
  if (req.method === 'GET' && url.pathname === '/api/applications/@me') {
    if (req.headers.authorization !== 'Bot test-token') return res.writeHead(401).end('{}');
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: '123', name: 'テストアプリ', verify_key: pubHex }));
  }
  if (req.method === 'PUT' && url.pathname === '/api/applications/123/commands') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      registered = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(body);
    });
    return;
  }
  const edit = url.pathname.match(/^\/api\/webhooks\/([^/]+)\/([^/]+)\/messages\/@original$/);
  if (req.method === 'PATCH' && edit) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      edits.set(edit[2], JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
    });
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// ---- wrangler dev ----
try {
  await fetch(`${W}/`);
  console.error(`ポート ${WORKER_PORT} がすでに使われています。前回のテストのサーバーが残っていないか確認してください。`);
  process.exit(1);
} catch {
  // 空いている
}
rmSync('.wrangler/test-state', { recursive: true, force: true });
const vars = {
  DISCORD_PUBLIC_KEY: pubHex,
  DISCORD_API_BASE: `${MOCK}/api`,
  ALLOWED_ATTACHMENT_HOSTS: '127.0.0.1',
  MAX_FILE_MB: '1',
  DISCORD_BOT_TOKEN: 'test-token',
};
const dev = spawn(
  'npx',
  [
    'wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(WORKER_PORT),
    '--persist-to', '.wrangler/test-state', '--show-interactive-dev-session=false',
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ],
  {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32', // 子プロセス（workerd）ごと止められるようにする
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
  },
);
let devLog = '';
dev.stdout.on('data', (d) => (devLog += d));
dev.stderr.on('data', (d) => (devLog += d));

function stopDev() {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(dev.pid), '/T', '/F']);
    else process.kill(-dev.pid, 'SIGTERM');
  } catch {
    // すでに終了している
  }
}
process.on('SIGINT', () => shutdown(130));

function shutdown(code) {
  stopDev();
  mock.close();
  process.exit(code);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${W}/`);
      if (r.ok) return;
    } catch {
      // まだ起動していない
    }
    await sleep(500);
  }
  throw new Error(`wrangler dev did not start\n${devLog}`);
}

async function interact(payload, { signature = 'valid' } = {}) {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { 'Content-Type': 'application/json' };
  if (signature !== 'none') {
    headers['X-Signature-Timestamp'] = ts;
    headers['X-Signature-Ed25519'] =
      signature === 'valid' ? sign(null, Buffer.from(ts + body), privateKey).toString('hex') : '00'.repeat(64);
  }
  return fetch(`${W}/interactions`, { method: 'POST', headers, body });
}

async function waitEdit(token) {
  for (let i = 0; i < 100; i++) {
    if (edits.has(token)) return edits.get(token);
    await sleep(100);
  }
  throw new Error(`no edit for ${token}\n${devLog}`);
}

const command = (token, message) => ({
  type: 2,
  application_id: 'app-1',
  token,
  data: { type: 3, name: 'Open in Viewer', target_id: message.id, resolved: { messages: { [message.id]: message } } },
});

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(['✓', name]);
  } catch (err) {
    results.push(['✗', name, err]);
  }
}

try {
  await waitReady();
  const buttonsOf = (edit) => edit.components.flatMap((row) => row.components);
  const urls = {};

  await test('署名なしは 401', async () => {
    assert.equal((await interact({ type: 1 }, { signature: 'none' })).status, 401);
  });
  await test('不正な署名は 401', async () => {
    assert.equal((await interact({ type: 1 }, { signature: 'bad' })).status, 401);
  });
  await test('PING に PONG を返す', async () => {
    const r = await interact({ type: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { type: 1 });
  });

  await test('添付ファイル: 自分だけに見える「考え中」→ リンクボタンに更新', async () => {
    const r = await interact(
      command('tok-files', {
        id: 'm1',
        content: '資料です',
        attachments: [
          att('spec.md'),
          att('sjis.md'),
          att('page.html', { content_type: 'text/html; charset=utf-8' }),
          att('collect.ps1'),
          att('data.json'),
          att('photo.png', { content_type: 'image/png' }),
          att('huge.md', { size: 5 * 1024 * 1024 }),
        ],
      }),
    );
    assert.deepEqual(await r.json(), { type: 5, data: { flags: 64 } });
    const edit = await waitEdit('tok-files');
    assert.match(edit.content, /ビューワーで開けます（7日間有効）/);
    assert.match(edit.content, /photo\.png: 未対応の形式/);
    assert.match(edit.content, /huge\.md: サイズ上限（1MB）を超えています/);
    assert.deepEqual(edit.allowed_mentions, { parse: [] });
    const buttons = buttonsOf(edit);
    assert.deepEqual(buttons.map((b) => b.label), ['📝 spec.md', '📝 sjis.md', '🌐 page.html', '📄 collect.ps1', '📄 data.json']);
    for (const b of buttons) {
      assert.equal(b.style, 5);
      assert.match(b.url, new RegExp(`^${W}/v/[A-Za-z0-9_-]{22}$`));
      urls[b.label.split(' ')[1]] = b.url;
    }
  });

  await test('ビューワー画面が開ける（CSP付き）', async () => {
    const r = await fetch(urls['spec.md']);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    const html = await r.text();
    assert.match(html, /data-kind="md"/);
    assert.match(html, /<title>spec\.md<\/title>/);
  });

  await test('Shift_JIS を判定して charset を付ける', async () => {
    const id = urls['sjis.md'].split('/').pop();
    const view = await (await fetch(urls['sjis.md'])).text();
    assert.match(view, /data-charset="shift_jis"/);
    const raw = await fetch(`${W}/raw/${id}`);
    assert.equal(raw.headers.get('content-type'), 'text/plain; charset=shift_jis');
    assert.match(raw.headers.get('content-security-policy'), /^sandbox; default-src 'none'/);
  });

  await test('HTML はサンドボックス付きで配信し、ストレージ代替を差し込む', async () => {
    const id = urls['page.html'].split('/').pop();
    const raw = await fetch(`${W}/raw/${id}`);
    assert.equal(raw.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(raw.headers.get('content-security-policy'), /^sandbox allow-scripts/);
    const text = await raw.text();
    assert.ok(text.startsWith('<!doctype html>'), 'doctype が先頭のまま');
    assert.match(text, /<head><script>\(function\(\)\{function m\(\)/);
    const dl = await fetch(`${W}/raw/${id}?dl=1`);
    assert.match(dl.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''page\.html$/);
    assert.equal(await dl.text(), HTML, 'ダウンロードは元のまま');
  });

  await test('言語判定（ps1 → powershell / json）', async () => {
    assert.match(await (await fetch(urls['collect.ps1'])).text(), /data-lang="powershell"/);
    assert.match(await (await fetch(urls['data.json'])).text(), /data-lang="json"/);
  });

  await test('添付なし → メッセージ本文を Markdown で開ける', async () => {
    await interact(command('tok-content', { id: 'm2', content: '# 本文\n\n| a | b |\n|---|---|\n| 1 | 2 |', attachments: [] }));
    const edit = await waitEdit('tok-content');
    const buttons = buttonsOf(edit);
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].label, '📝 メッセージ本文');
    urls['message'] = buttons[0].url;
  });

  await test('開けるものがない → 案内メッセージ', async () => {
    await interact(command('tok-none', { id: 'm3', content: '', attachments: [att('photo.png', { content_type: 'image/png' })] }));
    const edit = await waitEdit('tok-none');
    assert.match(edit.content, /開けるファイルが見つかりませんでした/);
    assert.deepEqual(edit.components, []);
  });

  await test('存在しない・不正なIDは 404', async () => {
    assert.equal((await fetch(`${W}/v/AAAAAAAAAAAAAAAAAAAAAA`)).status, 404);
    assert.equal((await fetch(`${W}/v/../../etc`)).status, 404);
    assert.equal((await fetch(`${W}/raw/short`)).status, 404);
  });

  await test('/setup でコマンドを登録してインストールリンクを表示', async () => {
    const r = await fetch(`${W}/setup`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /セットアップ完了/);
    assert.match(html, /client_id=123&amp;integration_type=1&amp;scope=applications\.commands/);
    assert.equal(registered[0].type, 3);
    assert.equal(registered[0].name_localizations.ja, 'ビューワーで開く');
    assert.doesNotMatch(html, /一致しません/);
  });

  await test('静的ファイル（ライブラリ）が配信される', async () => {
    for (const p of ['/viewer.js', '/viewer.css', '/vendor/marked.umd.js', '/vendor/purify.min.js', '/vendor/highlight.min.js', '/vendor/mermaid.min.js', '/vendor/github-markdown.css']) {
      assert.equal((await fetch(`${W}${p}`)).status, 200, p);
    }
  });

  for (const [mark, name, err] of results) {
    console.log(`${mark} ${name}`);
    if (err) console.log(`    ${String(err.stack || err).split('\n').slice(0, 6).join('\n    ')}`);
  }
  const failed = results.filter((r) => r[0] === '✗').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);

  if (keep) {
    console.log(`\nURLS ${JSON.stringify(urls)}`);
    console.log('サーバー起動中（Ctrl+C で終了）');
  } else {
    shutdown(failed ? 1 : 0);
  }
} catch (err) {
  console.error(err);
  shutdown(1);
}
