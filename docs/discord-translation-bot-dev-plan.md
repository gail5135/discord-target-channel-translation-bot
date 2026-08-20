# 번역 디스코드 봇 개발 계획서

## 문서 정보
| 항목 | 내용 |
|---|---|
| 문서명 | 번역 디스코드 봇 개발 계획서 |
| 기반 문서 | 번역 디스코드 봇 기획 및 사양서 v0.1 |
| 버전 | v0.1 (초안) |
| 작성일 | 2026-07-30 |
| 상태 | 개발 착수 전 |

---

## 1. 개요

본 문서는 「번역 디스코드 봇 기획 및 사양서」에서 정의한 요구사항을, 실제 코드로 구현하기 위한 기술 스택·아키텍처·개발 단계·일정을 정의한다.

Discord API를 다루는 라이브러리는 언어별로 여러 종류가 있으나(discord.py 등), 본 프로젝트는 **JavaScript/Node.js 진영의 대표 라이브러리인 `discord.js`**를 사용하는 것을 전제로 한다. 기존에 운영 중인 `reaction-summary-bot`(TypeScript + ts-node + pm2)과 동일한 기술 기반을 그대로 이어간다.

---

## 2. 기술 스택

| 구분 | 선택 | 비고 |
|---|---|---|
| 언어 | TypeScript | 기존 `reaction-summary-bot`과 동일한 컨벤션 유지, 타입 안정성 확보 |
| 실행 환경 | Node.js 22 LTS 이상 | discord.js 최신 버전(14.x)이 Node 22+ 를 요구하는 추세이므로, 배포 서버에도 해당 버전 설치 필요 |
| Discord 라이브러리 | `discord.js` v14.x (2026년 7월 기준 최신 14.27.0) | 슬래시 커맨드, 이벤트 리스너, Webhook 전송 등 전 기능 지원 |
| 실행기 | `ts-node` | 별도 빌드 단계 없이 TS 파일을 바로 실행 (기존 봇과 동일 방식) — 빌드 단계가 없으므로 `ts-node`/`typescript`는 devDependencies가 아니라 **런타임 의존성**(dependencies)으로 둔다 |
| 프로세스 매니저 | `pm2` | 크래시 시 자동 재시작, 로그 관리 |
| 설정 저장소 | JSON 파일 (Node.js 내장 `fs` 모듈) | 사양서 4.2.1 참고 — 별도 DB 없이 설정값 영구 저장. 네이티브 모듈 컴파일이 불필요해 e2-micro 배포에 유리 |
| 번역 API 클라이언트 | Node 내장 `fetch` | DeepL(1순위), Google Translate(2순위) 두 API만 호출 (Papago는 무료 제공 종료로 제외, 사양서 4.6). 테스트에서 가짜 응답을 넣을 수 있도록 `fetch`를 주입 가능하게 둔다 |
| 언어 감지 | `franc` 또는 각 번역 API의 자체 언어 감지 기능 | 우선 각 번역 API가 제공하는 언어 자동 감지를 활용하고, 필요 시 별도 라이브러리 도입 검토 |
| 환경변수 관리 | `dotenv` | 봇 토큰 및 번역 API 키(DeepL/Google, 전역 공용)를 `.env`로 관리 (서버별 설정값만 4.2.1에 따라 JSON 파일로 분리) |

---

## 3. 프로젝트 구조 (예시)

```
discord-translation-bot/
├── src/
│   ├── index.ts                 # 클라이언트 초기화 및 로그인
│   ├── deploy-commands.ts       # 슬래시 커맨드 등록 스크립트
│   ├── commands/
│   │   └── setting.ts            # /setting register·list·remove
│   ├── events/
│   │   ├── ready.ts
│   │   ├── interactionCreate.ts # 슬래시 커맨드 라우팅
│   │   └── messageCreate.ts     # 모니터링 채널 메시지 감지 → 번역 파이프라인 진입점
│   ├── services/
│   │   ├── translationService.ts # 다중 API 우선순위·failover 로직 (사양서 4.6)
│   │   ├── webhookService.ts     # 채널별 Webhook 확보 + 메모리 캐시 + 무효화 (사양서 4.4)
│   │   ├── channelPermissions.ts # 봇의 채널 권한 검사 (사양서 4.2.2)
│   │   ├── webhookIdentity.ts    # Webhook username 제약에 맞춘 이름 정제 (사양서 4.4)
│   │   └── configService.ts      # 설정 조회/변경 + 메모리 캐시
│   ├── store/
│   │   ├── jsonStore.ts          # JSON 파일 로드/원자적 저장 유틸
│   │   ├── configPath.ts         # config.json 정식 경로 상수
│   │   └── config.json           # 실제 설정 데이터 (gitignore 대상)
│   └── types/
│       └── index.ts
├── ecosystem.config.js          # pm2 설정
├── .env                         # DISCORD_TOKEN, DEEPL_API_KEY, GOOGLE_TRANSLATE_API_KEY 등 민감 정보
├── tsconfig.json
└── package.json
```

---

## 4. 데이터 모델 (JSON 구조 초안)

사양서 4.2.1의 저장소 설계를 구체화한 초안이다. 최상위를 `guildId`로 키잉하여 향후 다중 서버 확장에도 대응할 수 있는 구조로 둔다. 번역 API 키는 여기 포함되지 않는다 — 사양서 4.6에 따라 `.env`에 전역으로 보관한다.

```jsonc
// store/config.json
{
  "version": 1,
  "guilds": {
    "123456789012345678": {                    // guildId
      "translations": [
        {
          "id": "cfg_01",                      // /setting remove 에서 사용할 식별자
          "sourceChannelId": "111111111111111111",
          "targetChannelId": "222222222222222222",
          "targetLanguage": "ko",              // 봇 내부 언어 코드 (LanguageCode 유니온)
          "createdAt": "2026-07-30T09:00:00Z"
        }
      ]
    }
  }
}
```

> Webhook 정보는 이 파일에 저장하지 않는다. 초안에는 `webhookCache` 필드가 있었으나 Phase 4에서 **메모리 캐시만 두기로 확정**해 삭제했다. 근거는 `docs/superpowers/specs/2026-08-20-phase4-webhook-identity-design.md` §2.1·§2.2.

**구현 시 고려사항**

- **로드/저장 전략**: 봇 구동 시 파일 전체를 읽어 메모리에 캐시하고, 슬래시 커맨드로 변경이 발생할 때만 파일에 기록한다. 메시지 이벤트 처리 시에는 메모리 캐시만 참조하므로 파일 I/O가 발생하지 않는다. 캐시는 `configService`가 소유하며 구동 시 `initialize()`로 1회 적재한다.
- **캐시/디스크 일관성**: 캐시를 먼저 고치고 저장하면 저장 실패 시 메모리와 디스크가 어긋난다. **사본 수정 → 저장 성공 → 캐시 반영** 순서로 처리하고, 저장이 실패하면 캐시를 손대지 않은 채 예외를 전파한다. pm2 단일 프로세스 운영을 전제하므로 프로세스 간 캐시 동기화는 다루지 않는다.
- **원자적 쓰기**: 쓰기 중 프로세스가 종료되어 파일이 손상되는 것을 막기 위해, 임시 파일에 먼저 기록한 뒤 `fs.rename`으로 교체한다.
- **파일 경로**: `store/configPath.ts`에 `path.join(__dirname, 'config.json')`으로 정의한 상수를 유일한 출처로 삼는다. `process.cwd()` 기준으로 잡으면 pm2 실행 디렉토리에 따라 설정 파일 위치가 달라진다.
- **타입 안정성**: `types/index.ts`에 위 구조에 대응하는 TypeScript 인터페이스를 정의하고, 파일 로드 시 스키마 유효성을 검증한다. `jsonStore`의 검증은 최상위 구조만 보므로, `configService.initialize()`에서 길드별로 `translations` 누락을 빈 배열로 채우는 정규화를 수행한다.
- **설정 ID**: `cfg_` + base36 6자 랜덤(길드 내 충돌 시 재생성). `/setting remove`가 자동완성을 쓰므로 사람이 ID를 읽거나 입력할 일이 없어 순번 카운터를 유지하지 않는다.
- **버전 필드**: 향후 구조 변경 시 마이그레이션이 가능하도록 최상위에 `version` 필드를 둔다.
- **보안**: `config.json`에 **자격증명이 없다.** 번역 API 키는 `.env`에 있고, Webhook 토큰은 Phase 4에서 저장하지 않기로 확정했다 — 채널별로 `fetchWebhooks()`로 조회하고 없으면 생성해 메모리에만 캐싱하며, 재시작 시 다시 확보한다. 담기는 것은 서버별 채널·언어 설정뿐이지만 공개할 정보는 아니므로 `.gitignore`와 파일 권한 `0o600`(쓰기 시 코드가 적용)은 유지한다.
- **백업**: 원자적 쓰기(`rename`)로 교체하기 직전에 기존 `config.json`을 `config.json.bak`으로 복사한다. 로드 시 파싱 실패 등 손상이 감지되면 `.bak`으로 폴백한다. 클라우드 업로드는 이번 범위에서 다루지 않는다.

---

## 5. 슬래시 커맨드 명세 (초안)

| 명령어 | 설명 | 파라미터 |
|---|---|---|
| `/setting register` | 모니터링 채널·출력 채널·타겟 언어를 세트로 등록 | `source-channel`(channel), `target-channel`(channel), `target-language`(string, choices) |
| `/setting list` | 현재 서버에 등록된 설정 목록 확인 | 없음 |
| `/setting remove` | 등록된 설정 세트 삭제 | `id`(자동완성 — 목록에서 선택) |

- `target-language`의 choices는 **DeepL이 지원하는 언어**를 기준으로 10개로 한정한다(Google은 130개 이상을 지원하므로 2순위 보완에는 제약이 없다). 선택지 표시명은 각 언어 자체 표기를 쓴다 — 어느 언어 사용자든 자기 언어를 알아볼 수 있어야 하기 때문이다.

  | 표시명 | 값 | 표시명 | 값 |
  |---|---|---|---|
  | 한국어 | `ko` | Français | `fr` |
  | English | `en` | Deutsch | `de` |
  | 日本語 | `ja` | Русский | `ru` |
  | 中文(简体) | `zh-CN` | Italiano | `it` |
  | Español | `es` | Bahasa Indonesia | `id` |

  제공자별 코드 표기 차이(예: DeepL의 `EN-US`)는 Phase 3의 `translationService`에서 변환한다.
- 번역 API 키/우선순위를 다루는 슬래시 커맨드는 없다. 사양서 4.6에 따라 DeepL/Google 키는 `.env`에 전역 보관하고 우선순위는 코드 상수로 고정하므로, 서버 관리자가 등록·조정할 대상 자체가 없다.
- 명령어와 파라미터 이름은 모두 **영어**로 작성한다 (예: `/설정`이 아닌 `/setting`). 디스코드 슬래시 커맨드 이름은 소문자와 하이픈(`-`)만 사용하는 것이 관례이다. 표시되는 **설명(description) 문구도 영어**로 작성한다 — 다국어 사용자가 함께 쓰는 서버가 대상이므로 영어를 공통어로 삼는다.
- 표에 적힌 `/setting register`, `/setting list`, `/setting remove`는 명령어 이름에 공백이 들어가는 것이 아니라, discord.js의 **서브커맨드(Subcommand)** 구조로 구현한다. 최상위 명령어 `setting` 하나를 등록하고, `SlashCommandBuilder`의 `.addSubcommand(...)`로 `register`/`list`/`remove`를 하위 명령으로 추가하는 방식이다. 사용자가 `/setting`까지 입력하면 디스코드 클라이언트가 서브커맨드 자동완성 목록을 보여주며, 그 결과 화면상으로는 `/setting register`처럼 공백이 있는 것처럼 보인다.
- `/setting` 계열 명령어는 사양서 6.1에 따라 **디스코드 자체 명령어 권한 설정(Integrations)** 으로 실행 가능 역할이 제한되므로, **사용자의 실행 자격**을 봇 코드에서 검증하지 않는다. 단, **봇 자신이 대상 채널에서 동작 가능한지**는 등록 시점에 검사한다(사양서 4.2.2) — 이는 다른 문제이며 원칙과 충돌하지 않는다.
- 채널 파라미터는 discord.js의 `ChannelType` 옵션을 사용해 텍스트 채널만 선택 가능하도록 제한한다.

---

## 6. 개발 단계 (Phase)

### Phase 0 — 환경 준비
- Discord Developer Portal에서 애플리케이션·봇 생성, 사양서 6.2의 인텐트/OAuth2 스코프/권한 체크리스트 반영
- GCP e2-micro 인스턴스 프로비저닝 (기존 `reaction-summary-bot`과 동일 리전/방식)
- 리포지토리 초기화, TypeScript/ts-node/discord.js 기본 골격 셋업

### Phase 1 — 기본 골격
- discord.js 클라이언트 연결 및 로그인 확인 (`ready` 이벤트)
- JSON 파일 저장소 유틸(`jsonStore.ts`) 구현 — 로드/원자적 저장, 파일 부재 시 기본 구조 생성, 스키마 유효성 검증
- 슬래시 커맨드 등록 스크립트(`deploy-commands.ts`) 작성, 테스트 서버에 명령어 배포

### Phase 2 — 설정 커맨드 구현
- `/setting register·list·remove` 구현 및 JSON 저장소 연동

### Phase 3 — 번역 파이프라인 구현
- `messageCreate` 이벤트에서 모니터링 채널 여부 판별
- 봇/웹훅이 작성한 메시지(`author.bot` 또는 `webhookId` 존재) 무시 (루프 방지, 사양서 4.1)
- `.env`의 DeepL/Google 키로 고정 우선순위(deepl → google) 순차 호출 → 실패 시 failover (사양서 4.6). 언어 감지는 API 응답에 맡기고, 감지 언어가 타겟과 같으면 번역문 대신 원문을 게시한다
- 채널별 직렬 큐로 처리해 같은 채널의 번역문 순서를 보장한다. 전부 실패 시 출력 채널에 알리되 채널당 10분 쿨다운을 건다
- Phase 3은 봇 명의로 게시한다. Webhook 전송과 첨부파일 전달은 Phase 4에서 교체·추가한다
- 번역 실패(전체 API 소진) 시 처리 정책 구현

### Phase 4 — 출력 채널 게시 구현
- 채널별 Webhook 확보(`fetchWebhooks` → 없으면 `createWebhook`) + **메모리 캐시**. 토큰을 디스크에 저장하지 않는다 (`webhookService.ts`)
- 원 발신자 이름/아바타로 Webhook 메시지 전송. 본문 첫 줄의 `**작성자**` 접두는 제거(이름이 헤더로 올라가므로 중복)
- Webhook `username` 제약(1~80자, `discord`/`clyde` 불가)에 맞춘 이름 정제 (`webhookIdentity.ts`)
- 첨부파일 URL을 본문 뒤에 텍스트로 덧붙임(재업로드 없음 — egress). **본문 없이 첨부만 있는 메시지도 전달**하며 이때 번역 API는 호출하지 않는다
- Webhook 확보 실패 시 봇 명의로 폴백, 전송 실패 시 캐시 무효화로 자가 치유 (사양서 4.4)
- 2000자 분할과 원문 링크는 Phase 3의 `splitForDiscord`를 그대로 재사용 (사양서 4.5)
- `GuildConfig.webhookCache`와 `WebhookCacheEntry` 타입 삭제 — 쓰지 않기로 확정된 필드

### Phase 5 — 안정화 및 배포
- 에러 핸들링/로깅 정비 (API 실패, 권한 부족, Webhook 생성 실패 등 케이스별 대응)
- pm2 `ecosystem.config.js` 작성 및 GCP e2-micro 배포
- 테스트 서버에서 통합 테스트 후, 실 서버 적용

---

## 7. 대략적인 일정 (1인 개발 기준 예상치)

| Phase | 예상 소요 |
|---|---|
| Phase 0. 환경 준비 | 0.5주 |
| Phase 1. 기본 골격 | 1주 |
| Phase 2. 설정 커맨드 | 1주 |
| Phase 3. 번역 파이프라인 | 1.5주 |
| Phase 4. 출력 채널 게시(Webhook) | 1주 |
| Phase 5. 안정화 및 배포 | 1주 |
| **합계** | **약 6주** |

> 실제 소요는 번역 API 응답 지연/쿼터 정책 확인, GCP 리소스 이슈 대응 등에 따라 유동적이다.

---

## 8. 리스크 및 대응 방안

| 리스크 | 영향 | 대응 방안 |
|---|---|---|
| GCP e2-micro의 낮은 RAM(약 1GB)에서 다수 메시지 이벤트 동시 처리 시 성능 저하 | 번역 지연, 프로세스 다운 | 메시지 큐잉/배치 처리 검토 |
| 번역 API(DeepL/Google) 쿼터 초과 | 번역 실패 증가 | 우선순위 failover(사양서 4.6)로 완화, 콘솔에서 쿼터 사용량 주기적 확인 |
| Webhook 생성 실패(권한 부족 등) | 발신자 명의 표시 불가 | Manage Webhooks 권한 재확인 절차를 배포 체크리스트에 포함 |
| 번역 API 키 유출 리스크 | 키 오·남용 시 쿼터 소진/과금 | 키를 `.env`에만 보관하고 `.gitignore` 포함, 서버 파일 권한(chmod 600) 유지 |
| 설정 JSON 파일 손상 또는 유실 | 전체 설정 초기화, 봇 동작 불능 | 원자적 쓰기(임시 파일 + rename) 적용, 로드 시 유효성 검증 후 실패 시 로컬 백업본(`.bak`)으로 폴백 |
| GCP e2-micro 월 egress 1GB 제한 초과 | 서비스 중단/과금 | 로깅 최소화, 트래픽 모니터링 |

---

## 9. 참고 자료
- discord.js 공식 문서 (discord.js.org) — 최신 버전 14.27.0 기준, Node.js 22.12 이상 요구
- 기존 `reaction-summary-bot` 리포지토리(GitHub: `gail5135/discord-message-reaction-summary-bot`) — 배포 방식(pm2 + ts-node) 참고
- GitHub: [gail5135/discord-forum-reaction-summary-bot](https://github.com/gail5135/discord-forum-reaction-summary-bot) — 포럼 채널 대응 리액션 요약 봇 구현 참고
- 번역 디스코드 봇 기획 및 사양서 v0.1 (본 계획서의 기반 문서)
