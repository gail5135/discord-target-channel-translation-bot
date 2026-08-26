# Discord Translation Bot

지정한 채널의 새 메시지를 감지해 번역하고, 별도 채널에 **원 발신자의 이름과 아바타로** 게시하는 디스코드 봇입니다.

번역문이 봇 이름으로 뭉뚱그려지지 않아 누가 한 말인지 그대로 보입니다. 각 메시지에는 원문으로 이동하는 링크가 붙습니다.

```
#일본어-채널                      #한국어-미러
┌─────────────────────┐          ┌─────────────────────┐
│ Yuki                │          │ Yuki                │
│ おはようございます   │   ──▶    │ 좋은 아침입니다      │
│                     │          │ https://discord.c…  │
└─────────────────────┘          └─────────────────────┘
```

## 동작 방식

- 원본 채널을 상시 감시하다 새 메시지가 오면 번역해 출력 채널에 게시합니다
- 게시는 Discord Webhook을 써서 **원 발신자 명의**로 이루어집니다 (서버 별명과 아바타를 따릅니다)
- 번역 제공자는 **DeepL(1순위) → Google Translate(2순위)** 고정 순서로, 앞이 실패하면 다음으로 넘어갑니다
- 감지된 언어가 타겟 언어와 같으면 번역하지 않고 원문을 그대로 게시합니다
- 봇과 Webhook이 보낸 메시지는 무시합니다 (번역 루프 방지)
- 출력 채널에서는 멘션이 다시 울리지 않습니다 (미러이므로)
- 첨부파일은 링크로 전달합니다 — 내려받아 재업로드하지 않습니다

## 필요한 것

- Node.js 22 LTS 이상
- Discord 봇 애플리케이션 ([Developer Portal](https://discord.com/developers/applications))
- DeepL 또는 Google Cloud Translation API 키 (**둘 중 하나만 있어도 동작합니다**)

### Discord 설정

**Privileged Gateway Intents** (Bot 탭)

| 인텐트 | 필요성 |
|---|---|
| MESSAGE CONTENT INTENT | **필수** — 없으면 메시지 내용 자체를 받을 수 없습니다 |
| SERVER MEMBERS INTENT | 권장 |

**OAuth2 스코프**: `bot`, `applications.commands`

**봇 권한**

| 권한 | 어디에 | 등록 시 검사 |
|---|---|---|
| View Channel | 원본 채널, 출력 채널 | ✓ |
| Send Messages | 출력 채널 | ✓ |
| Manage Webhooks | 출력 채널 — 원 발신자 명의 게시에 필요합니다 | ✓ |
| Read Message History, Embed Links | 출력 채널 | — |

`/setting register`는 View Channel · Send Messages · Manage Webhooks만 검사해 부족하면 등록을 거부합니다. 나머지 둘은 검사하지 않아 없어도 등록은 통과하지만, 봇을 초대할 때는 함께 부여해 두는 편이 좋습니다.

## 로컬 실행

```bash
git clone https://github.com/gail5135/discord-target-channel-translation-bot.git
cd discord-target-channel-translation-bot
npm ci

cp .env.example .env
# .env를 열어 값을 채웁니다
chmod 600 .env

npm run build             # TypeScript -> dist/ 컴파일
npm run deploy-commands   # 슬래시 커맨드 등록 (커맨드가 바뀔 때만 다시 실행)
npm start                 # dist/index.js 실행
```

**`.env`는 저장소에 없습니다.** 자격증명이 들어가므로 `.gitignore` 대상이며, 직접 만들어야 합니다. `.env.example`이 필요한 변수 목록입니다.

| 변수 | 내용 |
|---|---|
| `DISCORD_TOKEN` | 봇 토큰 |
| `DISCORD_CLIENT_ID` | 애플리케이션 ID |
| `DISCORD_GUILD_ID` | 봇을 쓸 서버(길드) ID. 슬래시 커맨드가 이 서버에 등록됩니다 (즉시 반영) |
| `DEEPL_API_KEY` | 무료 키는 `:fx`로 끝납니다. 엔드포인트는 코드가 자동 판별합니다 |
| `GOOGLE_TRANSLATE_API_KEY` | Cloud Translation API를 활성화한 뒤 발급합니다 |

## 사용법

슬래시 커맨드는 기본적으로 **Manage Server** 권한을 가진 사람에게 열려 있습니다. 서버 설정 → 연동 → 봇 앱 → 명령어 권한에서 원하는 역할에 위임할 수 있습니다.

| 커맨드 | 설명 |
|---|---|
| `/setting register` | 원본 채널 · 출력 채널 · 타겟 언어를 한 세트로 등록합니다 |
| `/setting list` | 이 서버에 등록된 설정을 봅니다 |
| `/setting remove` | 등록된 설정을 지웁니다 (자동완성으로 고릅니다) |

한 원본 채널에는 설정 하나입니다. 같은 원본 채널로 다시 등록하면 덮어씁니다.

지원 언어: 한국어, English, 日本語, 中文(简体), Español, Français, Deutsch, Русский, Italiano, Bahasa Indonesia

**출력 채널을 누가 볼 수 있는지는 봇이 관여하지 않습니다.** 디스코드의 채널 권한(역할별 View Channel)으로 서버 관리자가 직접 정합니다.

## 설정 저장

서버별 채널·언어 설정은 저장소 루트의 `config.json`에 저장됩니다 (gitignore 대상). `dist/`가 빌드할 때마다 새로 만들어지므로 설정은 그 바깥에 둡니다. 구동 시 메모리에 캐시하고, 슬래시 커맨드로 변경될 때만 파일에 씁니다.

**이 파일에 자격증명은 없습니다.** API 키는 `.env`에 있고, Webhook 토큰은 아예 저장하지 않습니다(메모리 캐시만, 재시작 시 재조회).

쓰기는 임시 파일에 기록한 뒤 교체하는 원자적 쓰기이며, 교체 직전 기존 파일을 `config.json.bak`으로 백업합니다. 손상이 감지되면 백업으로 폴백합니다. 손으로 편집해도 되지만, 필드가 빠진 항목은 기동 시 걸러지고 로그에 개수가 남습니다.

## 개발

```bash
npm run dev         # ts-node로 직접 실행 (빌드 없이 반복 수정할 때)
npm test            # node:test 단위 테스트 — 소스(.ts)를 그대로 돌립니다
npm run typecheck   # tsc --noEmit — 테스트 파일까지 검사합니다
npm run build       # tsc -p tsconfig.build.json — dist/ 생성, 테스트는 제외
```

배포는 컴파일된 `dist/`를 실행합니다. ts-node는 TypeScript 컴파일러를 프로세스에 상주시켜 RSS가 **약 290MB** 더 드는데(실측 369MB vs 80MB), RAM 1GB인 배포 대상에서는 그 차이가 큽니다. 로컬에서 빠르게 고쳐가며 볼 때는 `npm run dev`가 편합니다.

## 배포

GCP e2-micro(Always Free)에 pm2로 올리는 절차는 [`docs/deployment.md`](docs/deployment.md)에 있습니다.

이 봇은 **기존에 다른 디스코드 봇이 돌고 있던 인스턴스에 함께 올려** 운영합니다. RAM·디스크·egress·pm2 전역 설정이 모두 공유 자원이므로, 같은 구성으로 올릴 계획이라면 [`docs/deployment.md` §1-B](docs/deployment.md)를 먼저 읽어주세요. pm2 명령에는 앱 이름(`discord-translation-bot`)을 명시합니다.

## 문서

| 문서 | 내용 |
|---|---|
| [`docs/discord-translation-bot-spec.md`](docs/discord-translation-bot-spec.md) | 기획 및 사양서 |
| [`docs/discord-translation-bot-dev-plan.md`](docs/discord-translation-bot-dev-plan.md) | 개발 계획서 |
| [`docs/deployment.md`](docs/deployment.md) | 배포 가이드 |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | Phase별 설계서 — 결정 근거와 배제한 대안 |
