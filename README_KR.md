# Discord Translation Bot

지정한 채널에 올라온 새 메시지를 감지해서 번역한 다음, 별도로 지정한 채널에 **원 발신자의 이름과 아바타로** 게시하는 디스코드 봇입니다.

번역된 메시지가 봇 명의로 통합되지 않기 때문에, 누가 작성한 메시지인지 그대로 확인할 수 있습니다. 각 메시지에는 원문으로 이동하는 링크가 함께 붙습니다.

```
#일본어-채널                      #한국어-미러
┌─────────────────────┐          ┌─────────────────────┐
│ Yuki                │          │ Yuki                │
│ おはようございます   │   ──▶    │ 좋은 아침입니다      │
│                     │          │ https://discord.c…  │
└─────────────────────┘          └─────────────────────┘
```

## 동작 방식

- 원본 채널을 상시 감시하다가 새 메시지가 올라오면 번역해서 출력 채널에 게시합니다
- 게시할 때에는 Discord Webhook을 사용하므로 **원 발신자 명의**로 표시되며, 서버 별명과 아바타를 그대로 따릅니다
- 번역 제공자는 **DeepL(1순위)에서 Google Translate(2순위)** 로 이어지는 고정 순서를 따르며, 앞선 제공자가 실패하면 다음 제공자로 넘어갑니다
- 감지된 언어가 타겟 언어와 같으면 번역하지 않고 원문을 그대로 게시합니다
- 봇과 Webhook이 보낸 메시지는 무시하므로, 번역이 반복되는 순환에 빠지지 않습니다
- 출력 채널은 미러이기 때문에, 원문에 포함된 멘션이 다시 울리지 않습니다
- 첨부파일은 링크로 전달하며, 파일을 내려받아 다시 업로드하지는 않습니다

## 필요한 것

- Node.js 22 LTS 이상
- 디스코드 봇 애플리케이션([Developer Portal](https://discord.com/developers/applications)에서 생성합니다)
- DeepL 또는 Google Cloud Translation API 키(**둘 중 하나만 있어도 동작합니다**)

### 디스코드 설정

**Privileged Gateway Intents**(Bot 탭에서 설정합니다)

| 인텐트 | 필요성 |
|---|---|
| MESSAGE CONTENT INTENT | **필수입니다.** 이 인텐트가 없으면 메시지 내용 자체를 받을 수 없습니다 |
| SERVER MEMBERS INTENT | 권장합니다 |

**OAuth2 스코프**: `bot`, `applications.commands`

**봇 권한**

| 권한 | 어느 채널에 필요한가 | 등록 시 검사 |
|---|---|---|
| View Channel | 원본 채널과 출력 채널 | ✓ |
| Send Messages | 출력 채널 | ✓ |
| Manage Webhooks | 출력 채널에 필요하며, 원 발신자 명의로 게시하려면 반드시 있어야 합니다 | ✓ |
| Read Message History, Embed Links | 출력 채널 | 검사하지 않습니다 |

`/setting register`는 View Channel과 Send Messages, Manage Webhooks 세 가지만 검사하며, 하나라도 부족하면 등록을 거부합니다. 나머지 두 권한은 검사하지 않기 때문에 없어도 등록은 통과하지만, 봇을 초대할 때 함께 부여해 두는 편이 좋습니다.

## 로컬 실행

```bash
git clone https://github.com/gail5135/discord-target-channel-translation-bot.git
cd discord-target-channel-translation-bot
npm ci

cp .env.example .env
# .env를 열어 값을 채웁니다
chmod 600 .env

npm run build             # TypeScript를 dist/로 컴파일합니다
npm run deploy-commands   # 슬래시 커맨드를 등록합니다 (커맨드가 바뀔 때만 다시 실행합니다)
npm start                 # dist/index.js를 실행합니다
```

**`.env` 파일은 저장소에 포함되어 있지 않습니다.** 자격증명이 들어가기 때문에 `.gitignore` 대상이며, 직접 만들어야 합니다. 필요한 변수의 목록은 `.env.example`에 정리되어 있습니다.

| 변수 | 내용 |
|---|---|
| `DISCORD_TOKEN` | 봇 토큰입니다 |
| `DISCORD_CLIENT_ID` | 애플리케이션 ID입니다 |
| `DISCORD_GUILD_ID` | 봇을 사용할 서버(길드)의 ID입니다. 슬래시 커맨드가 이 서버에 등록되며 즉시 반영됩니다 |
| `DEEPL_API_KEY` | 무료 키는 `:fx`로 끝납니다. 어느 엔드포인트를 사용할지는 코드가 자동으로 판별합니다 |
| `GOOGLE_TRANSLATE_API_KEY` | Cloud Translation API를 활성화한 다음 발급받습니다 |

## 사용법

슬래시 커맨드는 기본적으로 **Manage Server** 권한을 가진 사람에게 열려 있습니다. 서버 설정에서 연동을 거쳐 봇 앱의 명령어 권한으로 들어가면, 원하는 역할에 실행 권한을 위임할 수 있습니다.

| 커맨드 | 설명 |
|---|---|
| `/setting register` | 원본 채널과 출력 채널, 타겟 언어를 한 세트로 묶어서 등록합니다 |
| `/setting list` | 이 서버에 등록되어 있는 설정을 보여줍니다 |
| `/setting remove` | 등록된 설정을 삭제합니다. 자동완성 목록에서 고를 수 있습니다 |

원본 채널 하나에는 설정을 하나만 둘 수 있습니다. 같은 원본 채널로 다시 등록하면 기존 설정을 덮어씁니다.

지원하는 언어는 한국어, English, 日本語, 中文(简体), Español, Français, Deutsch, Русский, Italiano, Bahasa Indonesia입니다.

**출력 채널을 누가 볼 수 있는지에 대해서는 봇이 관여하지 않습니다.** 디스코드가 제공하는 채널 권한, 즉 역할별 View Channel 설정으로 서버 관리자가 직접 정합니다.

## 설정 저장

서버별 채널 설정과 언어 설정은 저장소 루트에 있는 `config.json`에 저장되며, 이 파일은 `.gitignore` 대상입니다. `dist/` 디렉토리는 빌드할 때마다 새로 만들어지기 때문에, 설정 파일은 그 바깥에 둡니다. 봇을 구동할 때 파일 전체를 읽어 메모리에 캐시해 두고, 슬래시 커맨드로 설정이 변경될 때만 파일에 기록합니다.

**이 파일에는 자격증명이 들어 있지 않습니다.** 번역 API 키는 `.env`에 있고, Webhook 토큰은 아예 저장하지 않습니다. Webhook 정보는 메모리에만 캐시하며, 봇을 재시작하면 다시 조회합니다.

파일에 기록할 때에는 임시 파일에 먼저 쓴 다음 교체하는 원자적 쓰기 방식을 사용하고, 교체하기 직전에 기존 파일을 `config.json.bak`으로 백업해 둡니다. 파일이 손상된 것이 감지되면 이 백업으로 폴백합니다. 손으로 편집해도 되지만, 필드가 빠진 항목은 구동할 때 걸러지며 그 개수가 로그에 남습니다.

## 개발

```bash
npm run dev         # ts-node로 직접 실행합니다 (빌드 없이 반복해서 수정할 때 사용합니다)
npm test            # node:test 단위 테스트입니다. 소스(.ts)를 그대로 실행합니다
npm run typecheck   # tsc --noEmit으로 테스트 파일까지 검사합니다
npm run build       # tsc -p tsconfig.build.json으로 dist/를 생성하며, 테스트는 제외합니다
```

배포할 때에는 컴파일된 `dist/`를 실행합니다. ts-node는 TypeScript 컴파일러를 프로세스에 상주시키기 때문에 RSS를 **약 290MB** 더 사용하는데(실측값은 369MB와 80MB입니다), RAM이 1GB인 배포 대상에서는 이 차이가 크게 작용합니다. 로컬에서 빠르게 고쳐가며 확인할 때에는 `npm run dev`가 편리합니다.

## 배포

GCP e2-micro(Always Free)에 pm2로 올리는 절차는 [`docs/deployment.md`](docs/deployment.md)에 정리되어 있습니다.

이 봇은 **기존에 다른 디스코드 봇이 돌고 있던 인스턴스에 함께 올려서** 운영하고 있습니다. RAM과 디스크, egress, pm2 전역 설정이 모두 공유 자원이 되기 때문에, 같은 구성으로 올릴 계획이라면 [`docs/deployment.md`의 1-B절](docs/deployment.md)을 먼저 읽어주세요. pm2 명령을 실행할 때에는 앱 이름(`discord-translation-bot`)을 반드시 명시합니다.

## 문서

| 문서 | 내용 |
|---|---|
| [`docs/discord-translation-bot-spec.md`](docs/discord-translation-bot-spec.md) | 기획 및 사양서입니다 |
| [`docs/discord-translation-bot-dev-plan.md`](docs/discord-translation-bot-dev-plan.md) | 개발 계획서입니다 |
| [`docs/deployment.md`](docs/deployment.md) | 배포 가이드입니다 |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | Phase별 설계서입니다. 결정의 근거와 배제한 대안을 함께 기록했습니다 |
