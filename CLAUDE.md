# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 프로젝트 컨텍스트입니다.

## 프로젝트 개요

디스코드 **번역 봇**입니다. 지정된 원본 채널을 상시 모니터링하여 새 메시지를 감지하고, 타겟 언어로 번역한 뒤, 별도로 지정된 출력 채널에 게시합니다.

핵심 차별점: 번역 메시지를 봇 명의가 아니라 **원 발신자의 이름/아바타로** 게시하며(Discord Webhook 활용), 각 메시지에 원문으로 이동하는 링크를 포함합니다.

## 문서

작업 전 반드시 읽어야 할 문서입니다.

- `docs/discord-translation-bot-spec.md` — 기획 및 사양서. 무엇을 만드는지, 왜 그렇게 결정했는지
- `docs/discord-translation-bot-dev-plan.md` — 개발 계획서. 기술 스택, 데이터 모델, Phase별 구현 순서
- `docs/discord-translation-bot-preview.html` — UX 미리보기 목업 (역할별 채널 노출 동작 확인용)
- `docs/superpowers/specs/` — Phase별 상세 설계서. 결정 근거와 배제한 대안까지 기록. 위 두 문서에는 확정 결론만 요약되어 있으므로, "왜 이렇게 했는지"가 필요하면 여기를 볼 것
- `docs/superpowers/plans/` — Phase별 구현 계획서 (태스크 단위 절차)

## 기술 스택

| 구분 | 선택 |
|---|---|
| 언어 | TypeScript |
| 런타임 | Node.js 22 LTS 이상 |
| Discord 라이브러리 | discord.js v14.x |
| 실행기 | ts-node (별도 빌드 단계 없음) |
| 프로세스 매니저 | pm2 |
| 설정 저장소 | **JSON 파일** (Node 내장 `fs`) — DB 없음 |
| 호스팅 | GCP e2-micro (Always Free) |

## 확정된 설계 결정

작업 중 이 결정들을 뒤집지 마세요. 변경이 필요해 보이면 먼저 물어보세요.

### 저장소는 JSON 파일 (SQLite 아님)

설정 데이터가 수 KB 수준이고 쓰기 빈도가 매우 낮아 SQLite는 과설계로 판단했습니다. 또한 `better-sqlite3`는 네이티브 모듈이라 RAM 1GB인 e2-micro에서 `npm install`이 메모리 부족으로 실패하는 사례가 흔합니다.

- 구동 시 파일 전체를 읽어 **메모리에 캐시**, 슬래시 커맨드로 변경될 때만 파일에 기록
- 메시지 이벤트 처리 시에는 메모리 캐시만 참조 (파일 I/O 없음)
- 쓰기는 임시 파일 기록 후 `fs.rename`으로 교체하는 **원자적 쓰기**, 교체 직전 기존 파일을 `config.json.bak`으로 복사해 로컬 백업 유지 (로드 시 손상 감지되면 `.bak`으로 폴백)
- `config.json`에는 번역 API 키가 없지만 Webhook 토큰(자격증명)이 담긴다. 웹훅 id+토큰만 있으면 봇 인증 없이 해당 채널에 임의 명의로 게시가 가능하므로, `.gitignore`는 필수이며 배포 서버에서는 `chmod 600`으로 보호한다

### 슬래시 커맨드는 영어, 서브커맨드 구조

- 명령어/파라미터 이름과 설명(description) 문구 모두 영어. 이름은 소문자+하이픈. 다국어 서버에서 쓰는 봇이므로 영어를 공통어로 삼는다
- 사용자에게 보이는 응답 문구도 모두 영어. 대상 서버에 일본어 사용자와 한국어 사용자가 함께 있어 영어가 양쪽이 읽을 수 있는 유일한 공통어다. 코드 주석은 한국어를 유지한다
- 예외: `target-language`의 선택지 표시명만 각 언어 자체 표기(`한국어`, `English`, `日本語`, `中文(简体)` …). 어느 언어 사용자든 자기 언어를 알아볼 수 있게 하기 위함
- `/setting register` 같은 형태는 공백이 아니라 `SlashCommandBuilder.addSubcommand()` 구조
- 명령어: `/setting register|list|remove` (번역 API 관련 슬래시 커맨드는 없음 — 아래 참고)

### 권한 검증 로직은 최소화

명령어 실행 권한은 봇 코드에서 `ADMINISTRATOR`를 하드코딩하지 않습니다. 디스코드 자체의 **명령어별 권한 설정(서버 설정 → 연동 → 봇 앱 → 명령어 권한)** 으로 서버 관리자가 원하는 역할에 위임합니다. 봇 등록 시 기본 권한은 `Manage Server` 수준으로 두고, 최종 조정은 각 서버 관리자에게 맡깁니다.

**이 원칙은 "사용자가 커맨드를 실행할 자격"에만 적용됩니다.** "봇 자신이 대상 채널에서 동작 가능한가"(View Channel / Send Messages / Manage Webhooks 보유 여부)는 별개 문제이며, `/setting register` 시점에 검사해 부족하면 거부합니다. 검사하지 않으면 등록은 성공하고 실제 게시 단계에서 조용히 실패합니다. 사양서 4.2.2 참고.

### 채널 접근 제어는 봇의 책임이 아님

출력 채널을 누가 볼 수 있는지는 디스코드 자체 채널 권한(Role 기반 View Channel)으로 **서버 관리자가 직접 설정**합니다. 봇은 해당 채널에 메시지를 보낼 뿐이며, 역할을 조회하거나 검증하지 않습니다. 따라서 `Manage Roles`, `Manage Channels` 권한이 필요 없습니다.

### 번역 API는 전역 고정 우선순위 failover (길드별 등록 아님)

지원 API는 DeepL, Papago 두 개뿐입니다(Google 제외). 이 봇을 설치하는 모든 서버가 봇 운영자의 키를 공용으로 사용하므로, 키는 `.env`에 전역으로 보관하고(`DEEPL_API_KEY`, `PAPAGO_CLIENT_ID`, `PAPAGO_CLIENT_SECRET`), 우선순위(`deepl` → `papago`)는 코드 상수로 고정합니다. 서버별로 키를 등록하거나 우선순위를 바꾸는 슬래시 커맨드는 없습니다. 1순위 실패(오류/쿼터 초과/타임아웃) 시 다음 순위로 자동 전환하며, 전부 실패하면 사용자에게 실패를 안내합니다.

## 필요한 Discord 설정

Developer Portal에서:

- **MESSAGE CONTENT INTENT** — 필수. 없으면 메시지 내용 자체를 수신 불가
- **SERVER MEMBERS INTENT** — 권장
- OAuth2 스코프: `bot`, `applications.commands`
- 봇 권한: Send Messages, **Manage Webhooks**, View Channels, Read Message History, Embed Links, Use Slash Commands

## 구현 순서 (Phase)

0. 환경 준비 — Developer Portal 설정, GCP 인스턴스, 리포지토리 골격
1. 기본 골격 — discord.js 연결, `jsonStore.ts`, 슬래시 커맨드 등록 스크립트
2. 설정 커맨드 — `/setting` 구현
3. 번역 파이프라인 — 메시지 감지, 봇/웹훅 무시, 언어 판별, 고정 우선순위 failover
4. 출력 채널 게시 — Webhook 생성/캐싱, 원 발신자 명의 전송, 원문 링크
5. 안정화 및 배포 — 에러 핸들링, pm2, 통합 테스트

현재 **Phase 2 완료** 상태입니다(실제 디스코드에서 수동 검증까지 통과). 구현된 것:

- discord.js 연결과 인터랙션 라우팅 — `src/index.ts`, `src/events/interactionCreate.ts`
- JSON 저장소와 메모리 캐시 — `src/store/jsonStore.ts`, `src/store/configPath.ts`, `src/services/configService.ts`
- `/setting register|list|remove` 전체 동작 (자동완성, 봇 권한 검증 포함) — `src/commands/setting.ts`, `src/services/channelPermissions.ts`

아직 없는 것: 메시지 감지와 번역(Phase 3), Webhook 게시(Phase 4). `src/index.ts`의 인텐트는 `Guilds`뿐이므로 Phase 3에서 `GuildMessages`와 `MessageContent` 추가가 필요합니다.

## 참고 리포지토리

같은 개발자의 기존 디스코드 봇으로, 배포 방식(pm2 + ts-node)과 프로젝트 구조를 참고합니다.

- https://github.com/gail5135/discord-forum-reaction-summary-bot

## 주의사항

- e2-micro는 RAM 약 1GB, 월 egress 1GB입니다. 무거운 의존성 추가나 과도한 로깅을 피하세요.
- 봇 토큰과 번역 API 키는 절대 코드나 커밋에 포함하지 마세요. 둘 다 `.env`로 관리합니다(서버별 채널/언어 설정만 `config.json`, gitignore 대상).
