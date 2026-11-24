// Discord Interactions: 署名検証 → メッセージコマンド「ビューワーで開く」の処理

import { detectKind } from './kinds.js';
import { putFile } from './store.js';

const EPHEMERAL = 1 << 6;
const MAX_FILES = 10;
const DEFAULT_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];
const ICONS = { md: '📝', html: '🌐', text: '📄' };

class UserError extends Error {}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('invalid hex');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

let keyCache = { hex: '', key: null };
async function publicKey(hex) {
  if (keyCache.hex !== hex) {
    const key = await crypto.subtle.importKey('raw', hexToBytes(hex), { name: 'Ed25519' }, false, ['verify']);
    keyCache = { hex, key };
  }
  return keyCache.key;
}

export async function verifySignature(publicKeyHex, signatureHex, timestamp, body) {
  try {
    const key = await publicKey(publicKeyHex.trim());
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      hexToBytes(signatureHex),
      new TextEncoder().encode(timestamp + body),
    );
  } catch {
    return false;
  }
}

export async function handleInteraction(request, env, ctx) {
  if (!env.DISCORD_PUBLIC_KEY) {
    console.error('DISCORD_PUBLIC_KEY is not set');
    return new Response('server not configured', { status: 500 });
  }
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  const body = await request.text();
  if (!signature || !timestamp || !(await verifySignature(env.DISCORD_PUBLIC_KEY, signature, timestamp, body))) {
    return new Response('invalid request signature', { status: 401 });
  }

  let interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return new Response('bad request', { status: 400 });
  }

  // PING（エンドポイントURL登録時の疎通確認）
  if (interaction.type === 1) return json({ type: 1 });

  // メッセージコマンド
  if (interaction.type === 2 && interaction.data?.type === 3) {
    const origin = (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, '');
    // 3秒以内に応答する必要があるので「考え中」を先に返し、処理は裏で続ける
    ctx.waitUntil(processMessageCommand(interaction, env, origin));
    return json({ type: 5, data: { flags: EPHEMERAL } });
  }

  return json({ type: 4, data: { content: 'この操作には対応していません。', flags: EPHEMERAL } });
}

async function processMessageCommand(interaction, env, origin) {
  let payload;
  try {
    payload = await buildReply(interaction, env, origin);
  } catch (err) {
    console.error('processing failed', err);
    payload = { content: '⚠️ 処理中にエラーが発生しました。もう一度試してください。' };
  }
  await editOriginal(env, interaction, payload);
}

async function fetchAttachment(att, { maxBytes, maxMb, allowedHosts }) {
  const tooLarge = () => new UserError(`サイズ上限（${maxMb}MB）を超えています`);
  if (Number(att.size) > maxBytes) throw tooLarge();
  let url;
  try {
    url = new URL(att.url);
  } catch {
    throw new UserError('URLが不正です');
  }
  if (!allowedHosts.has(url.hostname)) throw new UserError('取得元が許可されていません');
  const res = await fetch(url.toString());
  if (!res.ok) throw new UserError(`取得に失敗しました (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) throw tooLarge();
  return buf;
}

async function buildReply(interaction, env, origin) {
  const message = interaction.data.resolved?.messages?.[interaction.data.target_id];
  const maxMb = num(env.MAX_FILE_MB, 10);
  const ttlDays = num(env.TTL_DAYS, 7);
  const allowedHosts = new Set(
    (env.ALLOWED_ATTACHMENT_HOSTS ? env.ALLOWED_ATTACHMENT_HOSTS.split(',') : DEFAULT_HOSTS)
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  const opts = { maxBytes: maxMb * 1024 * 1024, maxMb, allowedHosts };

  const notes = [];
  const candidates = [];
  for (const att of message?.attachments ?? []) {
    const kind = detectKind(att.filename, att.content_type);
    if (kind) candidates.push({ att, kind });
    else notes.push(`・${att.filename}: 未対応の形式`);
  }
  if (candidates.length > MAX_FILES) {
    notes.push(`・ほか${candidates.length - MAX_FILES}件は上限（${MAX_FILES}件）のため省略`);
    candidates.length = MAX_FILES;
  }

  const results = await Promise.all(
    candidates.map(async ({ att, kind }) => {
      try {
        const buf = await fetchAttachment(att, opts);
        const id = await putFile(env, buf, { name: att.filename, kind, ttlDays });
        return { ok: true, id, name: att.filename, kind };
      } catch (err) {
        if (!(err instanceof UserError)) console.error('attachment failed', att.filename, err);
        return { ok: false, name: att.filename, reason: err instanceof UserError ? err.message : '取得できませんでした' };
      }
    }),
  );

  // 添付がなければ、メッセージ本文を Markdown として開けるようにする
  if (candidates.length === 0 && message?.content?.trim()) {
    const buf = new TextEncoder().encode(message.content).buffer;
    const id = await putFile(env, buf, { name: 'message.md', kind: 'md', ttlDays });
    results.push({ ok: true, id, name: 'メッセージ本文', kind: 'md' });
  }

  for (const r of results) if (!r.ok) notes.push(`・${r.name}: ${r.reason}`);
  const opened = results.filter((r) => r.ok);

  if (opened.length === 0) {
    return {
      content: ['開けるファイルが見つかりませんでした。', '対応形式: Markdown / HTML / テキスト・コード', ...notes].join('\n'),
      components: [],
    };
  }

  const buttons = opened.map((r) => ({
    type: 2,
    style: 5,
    label: truncate(`${ICONS[r.kind] || '📄'} ${r.name}`, 70),
    url: `${origin}/v/${r.id}`,
  }));
  const components = [];
  for (let i = 0; i < buttons.length; i += 5) components.push({ type: 1, components: buttons.slice(i, i + 5) });

  return {
    content: [`ビューワーで開けます（${ttlDays}日間有効）`, ...notes].join('\n'),
    components,
  };
}

function truncate(s, max) {
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function editOriginal(env, interaction, payload) {
  const base = (env.DISCORD_API_BASE || 'https://discord.com/api/v10').replace(/\/+$/, '');
  const url = `${base}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  const body = JSON.stringify({ ...payload, allowed_mentions: { parse: [] } });
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (https://github.com, 1.0) discord-file-viewer',
      },
      body,
    });
    if (res.ok) return;
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 1;
      await sleep(Math.min(retryAfter, 5) * 1000);
      continue;
    }
    console.error('failed to edit original response', res.status, await res.text());
    return;
  }
  console.error('failed to edit original response after retries');
}
