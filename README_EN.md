# Discord Translation Bot

A Discord bot that watches a channel, translates new messages, and reposts them in another channel **under the original author's name and avatar**.

Translations are not flattened into a single bot identity, so you can still see who said what. Every message carries a link back to the original.

```
#japanese-channel                 #korean-mirror
┌─────────────────────┐          ┌─────────────────────┐
│ Yuki                │          │ Yuki                │
│ おはようございます   │   ──▶    │ 좋은 아침입니다      │
│                     │          │ https://discord.c…  │
└─────────────────────┘          └─────────────────────┘
```

## How it works

- Watches a source channel, translates each new message, and posts it to an output channel
- Posts through a Discord Webhook so the message appears **under the original author** (server nickname and avatar)
- Providers run in a fixed order — **DeepL (first) → Google Translate (second)**; if one fails, the next takes over
- If the detected language already matches the target, the original text is posted unchanged
- Messages from bots and webhooks are ignored (prevents translation loops)
- Mentions do not ping again in the output channel (it is a mirror)
- Attachments are passed along as links — never downloaded and re-uploaded

## Requirements

- Node.js 22 LTS or newer
- A Discord bot application ([Developer Portal](https://discord.com/developers/applications))
- A DeepL or Google Cloud Translation API key (**either one alone is enough**)

### Discord setup

**Privileged Gateway Intents** (Bot tab)

| Intent | Why |
|---|---|
| MESSAGE CONTENT INTENT | **Required** — without it the bot cannot receive message content at all |
| SERVER MEMBERS INTENT | Recommended |

**OAuth2 scopes**: `bot`, `applications.commands`

**Bot permissions**

| Permission | Where | Checked at registration |
|---|---|---|
| View Channel | source channel, output channel | ✓ |
| Send Messages | output channel | ✓ |
| Manage Webhooks | output channel — required to post under the original author | ✓ |
| Read Message History, Embed Links | output channel | — |

`/setting register` only verifies View Channel, Send Messages, and Manage Webhooks, and refuses to register if any is missing. The other two are not checked, so registration succeeds without them — but grant them when you invite the bot anyway.

## Running locally

```bash
git clone https://github.com/gail5135/discord-target-channel-translation-bot.git
cd discord-target-channel-translation-bot
npm ci

cp .env.example .env
# open .env and fill in the values
chmod 600 .env

npm run build             # compile TypeScript -> dist/
npm run deploy-commands   # register slash commands (re-run only when they change)
npm start                 # run dist/index.js
```

**`.env` is not in the repository.** It holds credentials, so it is gitignored and you create it yourself. `.env.example` lists the variables you need.

| Variable | What it is |
|---|---|
| `DISCORD_TOKEN` | Bot token |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_GUILD_ID` | ID of the server (guild) the bot runs in. Slash commands are registered to this server (takes effect immediately) |
| `DEEPL_API_KEY` | Free keys end in `:fx`. The code picks the endpoint automatically |
| `GOOGLE_TRANSLATE_API_KEY` | Issued after enabling the Cloud Translation API |

## Usage

By default the slash commands are open to anyone with **Manage Server**. You can delegate them to other roles under Server Settings → Integrations → the bot app → Command Permissions.

| Command | Description |
|---|---|
| `/setting register` | Registers a source channel, output channel, and target language as one set |
| `/setting list` | Shows the settings registered on this server |
| `/setting remove` | Deletes a setting (pick it from autocomplete) |

One source channel holds one setting. Registering the same source channel again overwrites it.

Supported languages: 한국어, English, 日本語, 中文(简体), Español, Français, Deutsch, Русский, Italiano, Bahasa Indonesia

**The bot does not control who can see the output channel.** That is up to the server administrator, through Discord's own per-role View Channel permissions.

## Where settings are stored

Per-server channel and language settings live in `config.json` at the repository root (gitignored). `dist/` is rebuilt from scratch on every build, so the settings are kept outside it. The file is read into memory at startup and written only when a slash command changes something.

**There are no credentials in this file.** API keys live in `.env`, and webhook tokens are **never written to disk at all**. They are cached in process memory only, so they vanish when the bot restarts and are re-acquired per channel at that point.

Writes are atomic: the data goes to a temporary file that then replaces the original, and the previous version is copied to `config.json.bak` just before the swap. If the file is found corrupted, the bot falls back to the backup. You may edit it by hand — entries with missing fields are dropped at startup, and the count is logged.

## Development

```bash
npm run dev         # run directly with ts-node (fast edit loop, no build)
npm test            # node:test unit tests — runs the .ts sources as they are
npm run typecheck   # tsc --noEmit — includes test files
npm run build       # tsc -p tsconfig.build.json — emits dist/, excludes tests
```

Deployment runs the compiled `dist/`. ts-node keeps the TypeScript compiler resident in the process, costing roughly **290MB more RSS** (measured: 369MB vs 80MB), which matters a lot on a 1GB target. For quick local iteration, `npm run dev` is more convenient.

## Deployment

The procedure for running this on a GCP e2-micro (Always Free) instance with pm2 is in [`docs/deployment.md`](docs/deployment.md).

This bot runs **on an instance that already hosted another Discord bot**. RAM, disk, egress, and pm2's global settings are all shared resources, so read [`docs/deployment.md` §1-B](docs/deployment.md) first if you plan the same setup. Always name the app in pm2 commands (`discord-translation-bot`).

## Documents

The documents below are written in Korean.

| Document | Contents |
|---|---|
| [`docs/discord-translation-bot-spec.md`](docs/discord-translation-bot-spec.md) | Product specification |
| [`docs/discord-translation-bot-dev-plan.md`](docs/discord-translation-bot-dev-plan.md) | Development plan |
| [`docs/deployment.md`](docs/deployment.md) | Deployment guide |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | Per-phase design documents — rationale, and the alternatives that were rejected |
