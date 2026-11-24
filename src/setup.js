// GET /setup — Worker のシークレット DISCORD_BOT_TOKEN を使ってコマンドを登録する
// （PC から npm run setup を実行できないとき用。何度開いても同じ内容で上書きするだけ）

import { COMMANDS, installUrl } from './commands.js';

export async function runSetup(env) {
  const token = (env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) {
    return {
      ok: false,
      title: 'Bot Token が未設定です',
      lines: ['Cloudflare の Worker 設定 →「変数とシークレット」に、シークレット DISCORD_BOT_TOKEN を追加してから、もう一度このページを開いてください。'],
    };
  }
  const base = (env.DISCORD_API_BASE || 'https://discord.com/api/v10').replace(/\/+$/, '');
  const headers = {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'DiscordBot (https://github.com, 1.0) discord-file-viewer',
  };

  const meRes = await fetch(`${base}/applications/@me`, { headers });
  if (!meRes.ok) {
    return {
      ok: false,
      title: 'アプリ情報を取得できませんでした',
      lines: [`HTTP ${meRes.status}。DISCORD_BOT_TOKEN が正しいか確認してください。`],
    };
  }
  const me = await meRes.json();
  const lines = [`アプリ: ${me.name}（ID: ${me.id}）`];

  if (env.DISCORD_PUBLIC_KEY && env.DISCORD_PUBLIC_KEY.trim() !== me.verify_key) {
    lines.push('⚠ DISCORD_PUBLIC_KEY がこのアプリの Public Key と一致しません。wrangler.toml を確認してください。');
  }

  const cmdRes = await fetch(`${base}/applications/${me.id}/commands`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(COMMANDS),
  });
  if (!cmdRes.ok) {
    lines.push(`コマンド登録に失敗しました（HTTP ${cmdRes.status}）: ${(await cmdRes.text()).slice(0, 300)}`);
    return { ok: false, title: 'コマンドを登録できませんでした', lines };
  }
  lines.push('コマンド「ビューワーで開く」を登録しました。');
  lines.push('インストール用リンク（iPhoneで開いて「マイアプリに追加」）:');
  lines.push(installUrl(me.id));
  lines.push('登録が済んだら、DISCORD_BOT_TOKEN のシークレットは削除してもかまいません（動作には不要です）。');
  return { ok: true, title: 'セットアップ完了', lines, installUrl: installUrl(me.id) };
}
