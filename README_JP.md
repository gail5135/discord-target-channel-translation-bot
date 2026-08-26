# Discord Translation Bot

指定したチャンネルの新着メッセージを検知して翻訳し、別のチャンネルに**元の発言者の名前とアイコンで**投稿する Discord ボットです。

翻訳がボット名義にまとめられないので、誰の発言かがそのまま分かります。各メッセージには原文へ移動するリンクが付きます。

```
#日本語チャンネル                  #韓国語ミラー
┌─────────────────────┐          ┌─────────────────────┐
│ Yuki                │          │ Yuki                │
│ おはようございます   │   ──▶    │ 좋은 아침입니다      │
│                     │          │ https://discord.c…  │
└─────────────────────┘          └─────────────────────┘
```

## 動作

- 元チャンネルを常時監視し、新着メッセージを翻訳して出力チャンネルへ投稿します
- 投稿は Discord Webhook を使い、**元の発言者名義**で行われます(サーバーニックネームとアイコンに従います)
- 翻訳プロバイダは **DeepL(第1) → Google Translate(第2)** の固定順で、前者が失敗すると次に切り替わります
- 検出された言語がターゲット言語と同じ場合は、翻訳せず原文をそのまま投稿します
- ボットと Webhook が送ったメッセージは無視します(翻訳ループの防止)
- 出力チャンネルではメンションが再通知されません(ミラーのため)
- 添付ファイルはリンクで受け渡します — ダウンロードして再アップロードはしません

## 必要なもの

- Node.js 22 LTS 以上
- Discord ボットアプリケーション([Developer Portal](https://discord.com/developers/applications))
- DeepL または Google Cloud Translation の API キー(**どちらか一方だけでも動作します**)

### Discord の設定

**Privileged Gateway Intents**(Bot タブ)

| インテント | 必要性 |
|---|---|
| MESSAGE CONTENT INTENT | **必須** — これがないとメッセージ本文自体を受け取れません |
| SERVER MEMBERS INTENT | 推奨 |

**OAuth2 スコープ**: `bot`, `applications.commands`

**ボットの権限**

| 権限 | 対象 | 登録時に検査 |
|---|---|---|
| View Channel | 元チャンネル、出力チャンネル | ✓ |
| Send Messages | 出力チャンネル | ✓ |
| Manage Webhooks | 出力チャンネル — 元の発言者名義での投稿に必要です | ✓ |
| Read Message History, Embed Links | 出力チャンネル | — |

`/setting register` は View Channel・Send Messages・Manage Webhooks のみを検査し、不足していれば登録を拒否します。残りの2つは検査しないため無くても登録は通りますが、ボットを招待する際に一緒に付与しておくことをおすすめします。

## ローカル実行

```bash
git clone https://github.com/gail5135/discord-target-channel-translation-bot.git
cd discord-target-channel-translation-bot
npm ci

cp .env.example .env
# .env を開いて値を入力します
chmod 600 .env

npm run build             # TypeScript -> dist/ へコンパイル
npm run deploy-commands   # スラッシュコマンドの登録(コマンドが変わったときだけ再実行)
npm start                 # dist/index.js を実行
```

**`.env` はリポジトリに含まれていません。** 認証情報が入るため `.gitignore` の対象で、自分で作成します。必要な変数の一覧は `.env.example` にあります。

| 変数 | 内容 |
|---|---|
| `DISCORD_TOKEN` | ボットトークン |
| `DISCORD_CLIENT_ID` | アプリケーション ID |
| `DISCORD_GUILD_ID` | ボットを使うサーバー(ギルド)の ID。スラッシュコマンドはこのサーバーに登録されます(即時反映) |
| `DEEPL_API_KEY` | 無料キーは `:fx` で終わります。エンドポイントはコードが自動判別します |
| `GOOGLE_TRANSLATE_API_KEY` | Cloud Translation API を有効化してから発行します |

## 使い方

スラッシュコマンドは既定で **サーバー管理(Manage Server)** 権限を持つ人に開放されています。サーバー設定 → 連携サービス → ボットアプリ → コマンドの権限 から、任意のロールに委任できます。

| コマンド | 説明 |
|---|---|
| `/setting register` | 元チャンネル・出力チャンネル・ターゲット言語を1セットとして登録します |
| `/setting list` | このサーバーに登録されている設定を表示します |
| `/setting remove` | 登録済みの設定を削除します(オートコンプリートから選びます) |

1つの元チャンネルにつき設定は1つです。同じ元チャンネルで再登録すると上書きされます。

対応言語: 한국어, English, 日本語, 中文(简体), Español, Français, Deutsch, Русский, Italiano, Bahasa Indonesia

**出力チャンネルを誰が見られるかにボットは関与しません。** Discord のチャンネル権限(ロールごとの View Channel)で、サーバー管理者が直接決めます。

## 設定の保存

サーバーごとのチャンネル・言語設定は、リポジトリ直下の `config.json` に保存されます(gitignore 対象)。`dist/` はビルドのたびに作り直されるため、設定はその外に置きます。起動時にメモリへキャッシュし、スラッシュコマンドで変更されたときだけファイルへ書き込みます。

**このファイルに認証情報はありません。** API キーは `.env` にあり、Webhook トークンはそもそも保存しません(メモリキャッシュのみで、再起動時に取得し直します)。

書き込みは一時ファイルに記録してから置き換える原子的書き込みで、置き換える直前に既存ファイルを `config.json.bak` としてバックアップします。破損が検出された場合はバックアップにフォールバックします。手で編集しても構いませんが、フィールドが欠けた項目は起動時に取り除かれ、その件数がログに残ります。

## 開発

```bash
npm run dev         # ts-node で直接実行(ビルドせずに繰り返し修正するとき)
npm test            # node:test のユニットテスト — ソース(.ts)をそのまま実行します
npm run typecheck   # tsc --noEmit — テストファイルまで検査します
npm run build       # tsc -p tsconfig.build.json — dist/ を生成、テストは除外
```

デプロイはコンパイル済みの `dist/` を実行します。ts-node は TypeScript コンパイラをプロセスに常駐させるため RSS が**約 290MB** 多くかかり(実測 369MB 対 80MB)、RAM 1GB のデプロイ先ではこの差が大きく効きます。ローカルで素早く直しながら見るときは `npm run dev` が便利です。

## デプロイ

GCP e2-micro(Always Free)に pm2 で載せる手順は [`docs/deployment.md`](docs/deployment.md) にあります。

このボットは**既に別の Discord ボットが動いていたインスタンスに相乗りして**運用しています。RAM・ディスク・egress・pm2 のグローバル設定がすべて共有資源になるため、同じ構成で載せる予定なら [`docs/deployment.md` §1-B](docs/deployment.md) を先に読んでください。pm2 のコマンドにはアプリ名(`discord-translation-bot`)を明示します。

## ドキュメント

以下のドキュメントは韓国語で書かれています。

| ドキュメント | 内容 |
|---|---|
| [`docs/discord-translation-bot-spec.md`](docs/discord-translation-bot-spec.md) | 企画・仕様書 |
| [`docs/discord-translation-bot-dev-plan.md`](docs/discord-translation-bot-dev-plan.md) | 開発計画書 |
| [`docs/deployment.md`](docs/deployment.md) | デプロイガイド |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | フェーズ別の設計書 — 決定の根拠と、見送った代替案 |
