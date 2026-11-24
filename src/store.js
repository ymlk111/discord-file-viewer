// KV への保存・取得。値は元ファイルのバイト列そのまま、表示に必要な情報はメタデータに持つ

import { langOf } from './kinds.js';

export const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const key = (id) => `f:${id}`;

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// UTF-8 として読めればUTF-8。読めなければ HTML の meta 宣言、最後は Shift_JIS と見なす
export function detectCharset(buf, kind) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    // UTF-8 ではない
  }
  if (kind === 'html') {
    let head = '';
    for (const b of bytes.subarray(0, 4096)) head += String.fromCharCode(b);
    const m = head.match(/<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9_-]{2,40})/i);
    if (m) return m[1].toLowerCase();
  }
  return 'shift_jis';
}

function shorten(name, max = 150) {
  const s = String(name || 'file');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export async function putFile(env, buf, { name, kind, ttlDays }) {
  const id = randomId();
  const metadata = {
    n: shorten(name),
    k: kind,
    c: detectCharset(buf, kind),
    l: langOf(name, kind),
    t: Date.now(),
  };
  const expirationTtl = Math.max(60, Math.round(ttlDays * 86400));
  await env.FILES.put(key(id), buf, { expirationTtl, metadata });
  return id;
}

export async function getMeta(env, id) {
  const { value, metadata } = await env.FILES.getWithMetadata(key(id), { type: 'stream' });
  if (value === null) return null;
  await value.cancel();
  return metadata || {};
}

export async function getFile(env, id) {
  const { value, metadata } = await env.FILES.getWithMetadata(key(id), { type: 'arrayBuffer' });
  if (value === null) return null;
  return { body: value, meta: metadata || {} };
}
