// 登録するコマンド（scripts/setup.mjs と Worker の /setup で共用）
export const COMMANDS = [
  {
    name: 'Open in Viewer',
    name_localizations: { ja: 'ビューワーで開く' },
    type: 3, // MESSAGE（メッセージ長押しメニュー）
    integration_types: [0, 1], // サーバーインストール / ユーザーインストール
    contexts: [0, 1, 2], // サーバー / Botとの DM / それ以外の DM・グループ
  },
];

export const installUrl = (appId) =>
  `https://discord.com/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands`;
