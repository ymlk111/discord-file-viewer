// Discord File Viewer — Cloudflare Worker
//   POST /interactions  Discord からのインタラクション
//   GET  /v/:id         ビューワー画面
//   GET  /raw/:id       元ファイル（?dl=1 でダウンロード）
//   GET  /setup         コマンド登録（シークレット DISCORD_BOT_TOKEN が必要）
//   静的ファイル（/viewer.js, /viewer.css, /vendor/*）は public/ から配信

import { handleInteraction } from './discord.js';
import { renderMessage, renderSetup, renderViewer } from './pages.js';
import { runSetup } from './setup.js';
import { ID_RE, getFile, getMeta } from './store.js';
import { isSvg } from './kinds.js';

const VIEWER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  'media-src *',
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// 添付HTMLは別オリジン扱い（サンドボックス）で動かす。外部CDNの読み込みは許可
const HTML_SANDBOX = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals';
const TEXT_SANDBOX = "sandbox; default-src 'none'";

const COMMON_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
};

// サンドボックス内では localStorage / cookie へのアクセスが例外になり、
// それだけでページ全体が動かなくなることがあるので、メモリ上の代替を差し込む
const STORAGE_SHIM =
  '<script>(function(){function m(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},key:function(i){var a=Object.keys(d);return i<a.length?a[i]:null},get length(){return Object.keys(d).length}}}' +
  "['localStorage','sessionStorage'].forEach(function(n){try{window[n].getItem('_')}catch(e){try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch(_){}}});" +
  "try{document.cookie}catch(e){try{var c='';Object.defineProperty(document,'cookie',{get:function(){return c},set:function(v){},configurable:true})}catch(_){}}})();</script>";

function injectShim(buf) {
  const bytes = new Uint8Array(buf);
  let headText = '';
  for (const b of bytes.subarray(0, 8192)) headText += String.fromCharCode(b);
  const m = headText.match(/<head\b[^>]*>/i) || headText.match(/<html\b[^>]*>/i) || headText.match(/<!doctype[^>]*>/i);
  const at = m ? m.index + m[0].length : 0;
  const shim = new TextEncoder().encode(STORAGE_SHIM);
  const out = new Uint8Array(bytes.length + shim.length);
  out.set(bytes.subarray(0, at), 0);
  out.set(shim, at);
  out.set(bytes.subarray(at), at + shim.length);
  return out;
}

const htmlResponse = (body, status = 200, extra = {}) =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': VIEWER_CSP,
      'Cache-Control': 'no-store',
      ...COMMON_HEADERS,
      ...extra,
    },
  });

const notFound = () =>
  htmlResponse(renderMessage('見つかりません', 'リンクの有効期限が切れたか、URLが間違っています。Discordでもう一度「ビューワーで開く」を実行してください。'), 404);

async function viewPage(id, env) {
  if (!ID_RE.test(id)) return notFound();
  const meta = await getMeta(env, id);
  if (!meta) return notFound();
  return htmlResponse(
    renderViewer({ id, name: meta.n || 'file', kind: meta.k || 'text', charset: meta.c || 'utf-8', lang: meta.l || '' }),
    200,
    { 'Cache-Control': 'private, max-age=300' },
  );
}

async function rawFile(id, env, download) {
  if (!ID_RE.test(id)) return new Response('Not Found', { status: 404 });
  const file = await getFile(env, id);
  if (!file) return new Response('Not Found', { status: 404 });
  const { meta } = file;
  const name = meta.n || 'file';
  const charset = meta.c || 'utf-8';
  const isHtml = meta.k === 'html';
  const svg = isHtml && isSvg(name);

  let contentType = `text/plain; charset=${charset}`;
  if (isHtml) contentType = svg ? 'image/svg+xml' : `text/html; charset=${charset}`;
  const body = isHtml && !svg && !download ? injectShim(file.body) : file.body;

  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Security-Policy': `${isHtml ? HTML_SANDBOX : TEXT_SANDBOX}; frame-ancestors 'self'`,
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, max-age=3600',
      ...COMMON_HEADERS,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (pathname === '/interactions') {
        if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
        return await handleInteraction(request, env, ctx);
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      let m;
      if ((m = pathname.match(/^\/v\/([^/]+)\/?$/))) return await viewPage(m[1], env);
      if ((m = pathname.match(/^\/raw\/([^/]+)$/))) return await rawFile(m[1], env, url.searchParams.has('dl'));
      if (pathname === '/setup') {
        const result = await runSetup(env);
        return htmlResponse(renderSetup(result), result.ok ? 200 : 400);
      }
      if (pathname === '/') {
        return htmlResponse(renderMessage('Discord File Viewer', '動作中です。Discordでメッセージを長押し →「アプリ」→「ビューワーで開く」で使えます。'));
      }
      return notFound();
    } catch (err) {
      console.error(err);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};
