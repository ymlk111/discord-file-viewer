# Discord File Viewer

iPhone の Discord で、添付された **Markdown / HTML / テキスト・コード** を整形して読むためのビューワーです。
Cloudflare Workers で動く Discord アプリ（ユーザーインストール型）です。

**使い方**: メッセージを長押し →「アプリ」→「ビューワーで開く」
→ 自分にだけ見えるボタンが届き、タップすると Safari で整形表示されます。

| 形式 | 表示 |
|---|---|
| Markdown（.md など） | GitHub 風の表示、表（横スクロール）、コードの色分け、Mermaid 図、目次、ソース切替 |
| HTML（.html / .htm / .svg） | サンドボックス内で実行して表示、ソース切替、全画面 |
| テキスト・コード（.txt .log .json .ps1 .java .sql など） | 色分け、折返し切替、JSON の自動整形 |

- 添付がないメッセージは、本文を Markdown として開けます（Discord が描画しない表なども読めます）
- Shift_JIS のファイルも自動判定して表示します
- リンクの有効期限は 7 日（`TTL_DAYS` で変更可）

---

## セットアップ

作業は **A. Discord 側（iPhone で可）** → **B. デプロイ（PC）** → **C. インストール（iPhone）** の順です。

### A. Discord Developer Portal でアプリを作る

1. https://discord.com/developers/applications を開き **New Application**（名前は例: `ファイルビューワー`）
2. 左メニュー **Bot** → **Reset Token** → 表示されたトークンを控える
   - これだけで OK です。Application ID・Public Key・エンドポイントURL・インストール設定は B の `npm run setup` が自動で行います

> iPhone の Safari では「デスクトップ用Webサイトを表示」にすると操作しやすくなります。
> Bot Token はパスワードと同じ扱いです。Git やチャットに残さないでください。

### B. デプロイ（PC で実行）

前提: Node.js 22.9 以上、Cloudflare アカウント

```bash
git clone <このリポジトリ>
cd discord-file-viewer
npm ci

# 1. Cloudflare にログイン（ブラウザが開く。CI などでは CLOUDFLARE_API_TOKEN を設定しても可）
npx wrangler login

# 2. ファイル保存用の KV を作成し、表示された id を wrangler.toml の
#    REPLACE_WITH_KV_NAMESPACE_ID と置き換える
npx wrangler kv namespace create FILES

# 3. デプロイ（表示用ライブラリのコピーは自動で行われる）
npx wrangler deploy
#    → 出力された https://discord-file-viewer.<サブドメイン>.workers.dev を控える

# 4. .env を作成
cp .env.example .env
#    DISCORD_BOT_TOKEN= に A-2 のトークン
#    WORKER_URL=        に 3 の URL（末尾スラッシュなし）

# 5. Discord 側の設定を自動で行う
npm run setup
```

`npm run setup` がやること:

1. Bot Token からアプリ情報を取得
2. Public Key を Worker のシークレット `DISCORD_PUBLIC_KEY` に登録（`wrangler secret put`）
3. Interactions Endpoint URL を `<WORKER_URL>/interactions` に設定し、ユーザーインストールを有効化
4. メッセージコマンド「ビューワーで開く」を登録
5. インストール用リンクを表示

自動設定がうまくいかない場合は、表示されるメッセージのとおり Developer Portal で手動設定してください
（General Information → Interactions Endpoint URL / Installation → User Install）。

### B'. ブラウザだけでデプロイする場合（PC で npm を使わない）

1. Cloudflare ダッシュボード → Workers KV で名前空間を作り、id を `wrangler.toml` に書いて push
2. Developer Portal の General Information にある **Public Key** を `wrangler.toml` の `[vars]` に `DISCORD_PUBLIC_KEY = "..."` として追記して push（公開鍵なので Git に入れて問題ありません）
3. Workers & Pages → 作成 → **リポジトリをインポート** でこのリポジトリを選んでデプロイ（以後 push するたびに自動デプロイ）
4. Developer Portal → General Information → **Interactions Endpoint URL** に `https://<Worker のURL>/interactions` を入れて保存
5. Developer Portal → Installation → **User Install** にチェック、Install Link は「Discord Provided Link」
6. Worker の 設定 → 変数とシークレット に、シークレット `DISCORD_BOT_TOKEN`（A-2 のトークン）を追加
7. ブラウザで `https://<Worker のURL>/setup` を開く → コマンド登録とインストール用リンクの表示まで行われます
   （登録後は `DISCORD_BOT_TOKEN` を削除しても動きます）

### C. インストール（iPhone）

`npm run setup` の最後に表示されるリンク
（`https://discord.com/oauth2/authorize?client_id=<ID>&integration_type=1&scope=applications.commands`）
を iPhone で開き、**マイアプリに追加** → **認証**。

これで、どのサーバー・DM でもメッセージ長押し →「アプリ」→「ビューワーで開く」が使えます。
コマンドが出てこない場合は Discord アプリを一度終了して開き直してください。

---

## 仕組み

```
Discord ──(署名付きPOST)──▶ /interactions
                              │ 署名検証 → 「考え中」を即返す（自分にだけ表示）
                              │ 裏で添付ファイルを取得 → KV に保存（7日で自動削除）
                              └─▶ 元の返信をリンクボタン付きに書き換え
iPhone Safari ──▶ /v/<id>   ビューワー画面
               └▶ /raw/<id> 元ファイル（?dl=1 で保存）
```

- Discord の添付URLは約24時間で失効するため、コマンド実行時に中身をコピーして保存しています
- Worker に置く秘密情報は `DISCORD_PUBLIC_KEY`（公開鍵）だけです。Bot Token は `npm run setup` を実行する PC の `.env` にだけ置きます

## 設定（wrangler.toml の `[vars]`）

| 名前 | 既定値 | 内容 |
|---|---|---|
| `TTL_DAYS` | `7` | リンクの有効日数 |
| `MAX_FILE_MB` | `10` | 1ファイルの上限サイズ（KV の上限は 25MiB） |
| `PUBLIC_BASE_URL` | なし | 独自ドメインで公開する場合のURL（例: `https://viewer.example.com`） |

## 注意点

- **リンクを知っている人は誰でも見られます。** URL は推測できない長さのランダム文字列ですが、機密ファイルのリンクは共有しないでください
- 添付 HTML は別オリジン扱いのサンドボックスで動かしています。JavaScript や外部CDNの読み込みは動きますが、`localStorage` はページを閉じると消える仮の保存になります
- HTML から相対パスで参照している画像・CSS は表示されません（ファイル単体での表示のため）
- Cloudflare の無料枠では KV への書き込みが 1日1000回までです（1ファイル1回）

## 開発

```bash
npm test          # wrangler dev を起動し、Discord をまねたリクエストで一通りの流れを確認
npm test -- --keep  # テスト後もサーバーを起動したままにする（ブラウザで表示確認用）
npm run dev       # ローカル起動（.dev.vars に DISCORD_PUBLIC_KEY=... を書く）
```

```
src/index.js      ルーティング、ビューワー・元ファイルの配信
src/discord.js    署名検証、メッセージコマンドの処理
src/store.js      KV への保存、文字コード判定
src/kinds.js      拡張子 → 表示方法・ハイライト言語
src/pages.js      HTML テンプレート
public/           ビューワーの JS / CSS（ライブラリは public/vendor に自動コピー）
scripts/setup.mjs Discord 側の初期設定
scripts/vendor.mjs 表示用ライブラリのコピー
test/e2e.mjs      ローカル結合テスト
```

使用ライブラリ: marked, DOMPurify, highlight.js, github-markdown-css, Mermaid
