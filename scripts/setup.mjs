// Discord 側の初期設定をまとめて行う（デプロイ後に1回実行）
//   1. Bot Token からアプリ情報（Application ID / Public Key）を取得
//   2. Public Key を Worker のシークレット DISCORD_PUBLIC_KEY に登録
//   3. Interactions Endpoint URL とユーザーインストールを設定
//   4. メッセージコマンド「ビューワーで開く」を登録
//   5. インストール用リンクを表示
//
// 使い方: npm run setup   （.env に DISCORD_BOT_TOKEN と WORKER_URL を書いておく）
// オプション: --skip-secret  シークレット登録を飛ばす（手動で wrangler secret put した場合）

import { spawnSync } from 'node:child_process';

const API = 'https://discord.com/api/v10';
const token = (process.env.DISCORD_BOT_TOKEN || '').trim();
const workerUrl = (process.env.WORKER_URL || '').trim().replace(/\/+$/, '');
const skipSecret = process.argv.includes('--skip-secret');

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

if (!token) fail('DISCORD_BOT_TOKEN が設定されていません（.env を確認）');
if (!/^https:\/\/[^/]+$/.test(workerUrl)) fail('WORKER_URL は https://xxxx.workers.dev の形式で設定してください（末尾のパスなし）');

async function discord(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://github.com, 1.0) discord-file-viewer-setup',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. アプリ情報
console.log('1/5 アプリ情報を取得…');
const me = await discord('GET', '/applications/@me');
if (!me.ok) fail(`アプリ情報を取得できません (HTTP ${me.status})。Bot Token が正しいか確認してください。\n${JSON.stringify(me.data)}`);
const appId = me.data.id;
const publicKey = me.data.verify_key;
console.log(`   アプリ名: ${me.data.name} / Application ID: ${appId}`);

// 2. シークレット
if (skipSecret) {
  console.log('2/5 シークレット登録はスキップ（--skip-secret）');
} else {
  console.log('2/5 DISCORD_PUBLIC_KEY を Worker に登録…');
  const r = spawnSync('npx wrangler secret put DISCORD_PUBLIC_KEY', {
    input: `${publicKey}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true,
  });
  if (r.status !== 0) fail('wrangler secret put に失敗しました。先に `npx wrangler deploy` が成功しているか確認してください。');
}

// Worker が署名検証できる状態になるまで待つ（署名なしリクエストに 401 が返ればOK）
console.log('   Worker の応答を確認…');
let ready = false;
for (let i = 0; i < 10 && !ready; i++) {
  try {
    const res = await fetch(`${workerUrl}/interactions`, { method: 'POST', body: '{}' });
    ready = res.status === 401;
    if (!ready) await sleep(3000);
  } catch {
    await sleep(3000);
  }
}
if (!ready) fail(`${workerUrl}/interactions が想定どおり応答しません。デプロイ先URLとシークレットを確認してください。`);

// 3. エンドポイント URL とインストール設定
console.log('3/5 Interactions Endpoint URL を設定…');
const ep = await discord('PATCH', '/applications/@me', { interactions_endpoint_url: `${workerUrl}/interactions` });
if (!ep.ok) {
  fail(`Endpoint URL を設定できませんでした (HTTP ${ep.status})。\n${JSON.stringify(ep.data)}\n` +
    `Developer Portal の General Information → Interactions Endpoint URL に ${workerUrl}/interactions を貼って保存しても同じです。`);
}

console.log('   ユーザーインストールを有効化…');
const installParams = { scopes: ['applications.commands'], permissions: '0' };
const it = await discord('PATCH', '/applications/@me', {
  integration_types_config: {
    0: { oauth2_install_params: installParams },
    1: { oauth2_install_params: installParams },
  },
});
if (!it.ok) {
  console.warn(`   ⚠ 自動設定できませんでした (HTTP ${it.status}): ${JSON.stringify(it.data)}`);
  console.warn('   Developer Portal → Installation → Installation Contexts で「User Install」にチェックを入れてください。');
}

// 4. コマンド登録
console.log('4/5 メッセージコマンドを登録…');
const commands = [
  {
    name: 'Open in Viewer',
    name_localizations: { ja: 'ビューワーで開く' },
    type: 3, // MESSAGE（メッセージ長押しメニュー）
    integration_types: [0, 1], // サーバーインストール / ユーザーインストール
    contexts: [0, 1, 2], // サーバー / Botとの DM / それ以外の DM・グループ
  },
];
const cmd = await discord('PUT', `/applications/${appId}/commands`, commands);
if (!cmd.ok) fail(`コマンド登録に失敗しました (HTTP ${cmd.status})\n${JSON.stringify(cmd.data)}`);

// 5. インストールリンク
console.log('5/5 完了\n');
console.log('▼ このリンクをiPhoneで開いて「マイアプリに追加」してください');
console.log(`  https://discord.com/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands\n`);
console.log('使い方: Discordでメッセージを長押し →「アプリ」→「ビューワーで開く」');
