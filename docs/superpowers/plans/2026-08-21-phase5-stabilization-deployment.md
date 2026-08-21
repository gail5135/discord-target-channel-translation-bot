# Phase 5 안정화 및 배포 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 봇을 24시간 도는 서버 프로세스로 넘기기 위한 준비물(pm2 설정, 배포 문서, 공개 저장소 README)을 만들고, Phase 1~4에서 이월된 백로그를 전부 닫는다.

**Architecture:** 새 기능은 없다. 오래 돌 때만 드러나는 세 가지 결함(무한히 자라는 쿨다운 맵, 설정 삭제 후 남는 Webhook 토큰, 검증되지 않은 설정 원소)을 고치고, 읽는 사람을 헷갈리게 하는 것들을 정리하며, 테스트 공백을 메운다. 그 다음 `ecosystem.config.js`·`docs/deployment.md`·`README.md`를 작성한다. 실제 GCP 인스턴스 생성과 수동 검증은 이 계획의 범위 밖이다 — 사용자가 서버를 만든 뒤에 한다.

**Tech Stack:** TypeScript 5.6 (strict), Node.js 22 LTS 이상, discord.js v14.27, ts-node, pm2, `node:test` + `node:assert/strict`

**기반 문서:** `docs/superpowers/specs/2026-08-21-phase5-stabilization-deployment-design.md`

## Global Constraints

이 절은 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **`npm start`를 절대 실행하지 마라.** 디스코드 게이트웨이에 붙어 영원히 끝나지 않는다. 검증은 `npm test`와 `npm run typecheck`로만 한다.
- **새 npm 패키지를 추가하지 않는다.** `package.json`의 `dependencies`/`devDependencies`를 건드리지 말 것. (`pm2-logrotate`는 pm2 자체 모듈이라 `package.json`과 무관하며, 문서에만 등장한다.)
- **로깅 라이브러리를 도입하지 않는다.** `console.log`/`console.error`를 그대로 쓴다.
- **REST 오류 객체를 로그에 그대로 넘기지 않는다.** `@discordjs/rest`가 요청 URL을 통째로 담는데 Webhook 요청 URL에는 토큰이 들어 있다. Webhook 관련 오류는 `webhookService.describeError()`를 거친다.
- **메시지 본문을 로그에 남기지 않는다.** 디버깅용으로는 메시지 ID와 채널 ID만 남긴다.
- **자격증명을 코드나 커밋에 넣지 않는다.** `DISCORD_TOKEN`, `DEEPL_API_KEY`, `GOOGLE_TRANSLATE_API_KEY`는 `.env`에만 있다. 저장소는 **공개**되므로 예시 값도 실제 토큰 형태로 쓰지 말 것.
- **사용자에게 보이는 봇 응답 문구는 영어**(대상 서버에 한국어·일본어 사용자가 섞여 있어 영어가 유일한 공통어), **코드 주석은 한국어**를 유지한다.
- **문서(`README.md`, `docs/deployment.md`)는 한국어로 쓴다.** 저장소의 다른 문서가 전부 한국어이고, 문서의 독자는 봇을 설치·운영하는 개발자다. 영어 규칙은 디스코드 안에서 보이는 봇 응답 문구에만 적용된다.
- **테스트는 `node:test` + `node:assert/strict`**를 쓰고 파일은 대상 소스 옆에 `*.test.ts`로 둔다.
- TypeScript는 `strict: true`다. `any`를 쓰지 말고, 캐스트가 필요하면 이유를 주석으로 남긴다.
- 각 태스크는 **자체적으로 커밋**한다. 여러 태스크를 한 커밋에 몰지 말 것.

---

## 파일 구조

**새로 만드는 파일**

| 파일 | 책임 |
|---|---|
| `src/services/cooldown.ts` | 같은 키로 반복되는 알림·로그의 간격 제한. 만료 항목을 쓸어내 맵이 무한히 자라지 않게 한다 |
| `src/services/cooldown.test.ts` | 위의 단위 테스트 |
| `ecosystem.config.js` | pm2 설정 (프로젝트 루트) |
| `README.md` | 공개 저장소 첫 화면 |
| `docs/deployment.md` | GCP e2-micro 배포 절차·갱신·롤백·체크리스트 |

**수정하는 파일**

| 파일 | 무엇을 |
|---|---|
| `src/events/messageCreate.ts` | 쿨다운 맵 두 개를 `cooldown.ts`로 교체, `as unknown as WebhookHost` 이음매에 주석 |
| `src/services/configService.ts` | `translations[]` 원소 검증, `createdAt` 보존, 테스트용 캐시 리셋 |
| `src/services/configService.test.ts` | 위 세 가지 + 미초기화 예외 경로 테스트 |
| `src/commands/setting.ts` | 설정 삭제·대상 변경 시 Webhook 캐시 무효화, 중복 응답 블록 정리, 채널 라벨 통합 |
| `src/services/translationService.ts` | 테스트용 상태 리셋 |
| `src/services/translationService.test.ts` | 비-`Error` throw, `initializeTranslator` 배선 테스트 |
| `src/services/providers/google.test.ts` | `FROM_GOOGLE` 별칭 테스트 |
| `CLAUDE.md` | Phase 5 완료 상태 반영 |

**손대지 않는 것**: `package.json`(의존성·스크립트 모두), `tsconfig.json`, `src/store/jsonStore.ts`, `src/services/webhookService.ts`, `src/services/messageQueue.ts`, `src/services/messageChunks.ts`, `src/services/providers/deepl.ts`, `src/services/providers/google.ts`(구현), `src/index.ts`.

> **이미 끝난 것 — 다시 하지 마라:** 설계서 §2.2의 로깅 규칙은 커밋 `b6f6253`에서 `CLAUDE.md`에 이미 반영되었다.

---

## Task 1: 쿨다운 맵이 무한히 자라지 않게 한다

**Files:**
- Create: `src/services/cooldown.ts`
- Create: `src/services/cooldown.test.ts`
- Modify: `src/events/messageCreate.ts`

**배경:** `messageCreate.ts`에 `lastFailureNotice`와 `lastUnavailableLog` 두 개의 `Map<string, number>`가 있다. 항목이 추가되기만 하고 제거되지 않아, 실패를 한 번이라도 겪은 채널 수만큼 영구히 남는다. 24시간 도는 프로세스에서만 드러나는 문제다. 두 맵의 로직이 동일하므로 한 모듈로 뽑으면 증가 문제와 중복이 함께 해결된다.

**핵심 통찰:** 간격이 이미 지난 항목은 판정 결과에 아무 영향을 주지 않는다(`now - last < interval`이 어차피 false). 따라서 만료 항목을 지우는 것은 **동작을 바꾸지 않는다**. 발동 시점마다 쓸어내면 맵 크기가 "간격 안에 발동한 키 수"로 묶인다.

**Interfaces:**
- Consumes: 없음 (새 모듈)
- Produces: `createCooldown(intervalMs: number, now?: () => number): Cooldown`, `interface Cooldown { claim(key: string): boolean; size(): number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/services/cooldown.test.ts`를 새로 만든다:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCooldown } from './cooldown';

/** Date.now를 흉내 내는 수동 시계. 타이머를 쓰지 않아 테스트가 빠르고 흔들리지 않는다. */
function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

test('the first claim for a key succeeds', () => {
  const cooldown = createCooldown(1000, clock().now);

  assert.equal(cooldown.claim('a'), true);
});

test('a second claim inside the interval is refused', () => {
  const time = clock();
  const cooldown = createCooldown(1000, time.now);
  cooldown.claim('a');

  time.advance(999);

  assert.equal(cooldown.claim('a'), false);
});

test('a claim once the interval has elapsed succeeds again', () => {
  const time = clock();
  const cooldown = createCooldown(1000, time.now);
  cooldown.claim('a');

  time.advance(1000);

  assert.equal(cooldown.claim('a'), true);
});

test('keys are tracked independently', () => {
  const cooldown = createCooldown(1000, clock().now);

  assert.equal(cooldown.claim('a'), true);
  assert.equal(cooldown.claim('b'), true);
});

test('expired keys are swept so the map stays bounded', () => {
  const time = clock();
  const cooldown = createCooldown(1000, time.now);
  for (let i = 0; i < 100; i += 1) cooldown.claim(`channel-${i}`);
  assert.equal(cooldown.size(), 100);

  time.advance(1000);
  cooldown.claim('channel-fresh');

  assert.equal(cooldown.size(), 1);
});

test('keys still inside the interval survive the sweep', () => {
  const time = clock();
  const cooldown = createCooldown(1000, time.now);
  cooldown.claim('old');
  time.advance(600);
  cooldown.claim('recent');

  // t=1200 — old는 1200ms 전(만료), recent는 600ms 전(유효)
  time.advance(600);
  cooldown.claim('newest');

  assert.equal(cooldown.size(), 2);
  assert.equal(cooldown.claim('recent'), false);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './cooldown'`

- [ ] **Step 3: 모듈을 구현한다**

`src/services/cooldown.ts`를 새로 만든다:

```typescript
/**
 * 같은 키로 반복 발생하는 알림·로그의 간격을 제한한다.
 *
 * 간격이 지난 항목은 판정에 영향을 주지 않으므로, 발동할 때마다 쓸어낸다.
 * 그러지 않으면 실패를 한 번이라도 겪은 채널 수만큼 맵이 영구히 자란다 —
 * 24시간 도는 프로세스에서만 드러나는 문제다.
 */
export interface Cooldown {
  /** 간격이 지났으면 타이머를 다시 시작하고 true. 아직이면 false. */
  claim(key: string): boolean;
  /** 보관 중인 키 수. 맵이 무한히 자라지 않는지 테스트에서 확인하려고 노출한다. */
  size(): number;
}

/** `now`는 테스트에서 수동 시계를 주입하려고 받는다. 운영 코드는 기본값을 쓴다. */
export function createCooldown(intervalMs: number, now: () => number = Date.now): Cooldown {
  const lastFired = new Map<string, number>();

  return {
    claim(key: string): boolean {
      const at = now();
      const previous = lastFired.get(key);
      if (previous !== undefined && at - previous < intervalMs) return false;

      // 발동할 때만 쓸어낸다. 키당 간격에 한 번씩이므로 순회 비용이 문제 되지 않는다.
      for (const [existing, firedAt] of lastFired) {
        if (at - firedAt >= intervalMs) lastFired.delete(existing);
      }

      lastFired.set(key, at);
      return true;
    },
    size: () => lastFired.size,
  };
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: `fail 0`, 테스트 수가 100 → 106

- [ ] **Step 5: `messageCreate.ts`를 새 모듈로 갈아끼운다**

`src/events/messageCreate.ts`에서 import 블록에 다음을 추가한다(다른 import 아래):

```typescript
import { createCooldown } from '../services/cooldown';
```

14~17행의 다음 블록을

```typescript
/** 장애 중 출력 채널이 실패 알림으로 도배되지 않도록 채널당 재알림 간격을 둔다 */
const FAILURE_NOTICE_COOLDOWN_MS = 10 * 60 * 1000;
const lastFailureNotice = new Map<string, number>();
const lastUnavailableLog = new Map<string, number>();
```

이렇게 바꾼다:

```typescript
/** 장애 중 출력 채널이 실패 알림으로 도배되지 않도록 채널당 재알림 간격을 둔다 */
const FAILURE_NOTICE_COOLDOWN_MS = 10 * 60 * 1000;
const failureNotice = createCooldown(FAILURE_NOTICE_COOLDOWN_MS);
const unavailableLog = createCooldown(FAILURE_NOTICE_COOLDOWN_MS);
```

`notifyChannelUnavailable`을

```typescript
/** 채널이 사라진 상태가 지속되면 메시지마다 로그가 쌓인다. 같은 채널은 쿨다운 간격으로만 남긴다. */
function notifyChannelUnavailable(targetChannelId: string): void {
  if (!unavailableLog.claim(targetChannelId)) return;
  console.error(`[messageCreate] output channel ${targetChannelId} is unavailable`);
}
```

으로, `notifyFailure`의 앞 세 줄을

```typescript
async function notifyFailure(channel: TextChannel): Promise<void> {
  if (!failureNotice.claim(channel.id)) return;

  await channel
```

로 바꾼다. `notifyFailure`의 나머지(`.send({...})` 이하)는 그대로 둔다.

- [ ] **Step 6: `as unknown as WebhookHost` 이음매에 주석을 단다**

같은 파일 `postTranslation` 안의 다음 세 줄을

```typescript
  const webhook = botUserId
    ? await getWebhook(channel as unknown as WebhookHost, botUserId)
    : undefined;
```

이렇게 바꾼다:

```typescript
  // discord.js의 TextChannel은 WebhookHost가 요구하는 메서드를 실제로 갖고 있지만,
  // fetchWebhooks()가 돌려주는 Collection의 find 시그니처와 Webhook.send의 옵션 타입이
  // WebhookLike보다 넓어 직접 캐스트가 통하지 않는다.
  //
  // 여기가 discord.js와의 유일한 미검사 이음매다. WebhookHost/WebhookLike가 실제 타입과
  // 어긋나도 컴파일러는 잡지 못하고 런타임에 터진다 — discord.js를 올릴 때 확인할 것.
  // (discord.js v14.27에서 확인)
  const webhook = botUserId
    ? await getWebhook(channel as unknown as WebhookHost, botUserId)
    : undefined;
```

- [ ] **Step 7: 타입체크와 테스트를 돌린다**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: 타입 오류 없음, `fail 0`, 106 tests

`messageCreate.ts`에 단위 테스트는 없다(Phase 4에서 확정된 결정 — discord.js `Message`를 흉내 내는 비용이 얻는 것보다 크다). 배선의 정확성은 타입체크와 배포 후 수동 검증으로 확인한다.

- [ ] **Step 8: 커밋**

```bash
git add src/services/cooldown.ts src/services/cooldown.test.ts src/events/messageCreate.ts
git commit -m "fix: bound the failure-notice cooldown maps

만료 항목은 판정에 영향을 주지 않으므로 발동 시점마다 쓸어낸다. 두 맵의
로직이 같아 cooldown 모듈 하나로 합쳤다. discord.js와의 유일한 미검사
이음매인 as unknown as WebhookHost에 근거 주석을 남긴다."
```

---

## Task 2: 손상된 설정 원소가 핸들러를 터뜨리지 않게 한다

**Files:**
- Modify: `src/services/configService.ts`
- Modify: `src/services/configService.test.ts`

**배경:** 세 가지를 한 번에 다룬다. 모두 `configService.ts` 한 파일이고 같은 테스트 파일에서 검증된다.

1. **`translations[]` 원소 미검증** — `normalizeGuild`가 배열 여부만 보고 원소는 보지 않는다. 사양서 §4.2.1이 `config.json` 손편집을 장점으로 광고하므로 실제로 도달 가능한 경로이며, 필드가 빠진 원소는 메시지 처리 중에 터진다.
2. **`createdAt`이 이름과 다르다** — 덮어쓰기 때마다 새로 찍혀서 사실상 "최종 수정 시각"이다. `id`를 물려주는 것과 같은 이유로 `createdAt`도 물려주면 이름이 참이 된다. **필드 이름을 바꾸지 마라** — 이미 디스크에 있는 `config.json`이 `createdAt`을 쓰고 있어, 이름을 바꾸면 마이그레이션 없이는 기존 설정이 통째로 버려진다.
3. **미초기화 예외 경로에 테스트가 없다** — `requireCache()`가 던지는 경로.

**Interfaces:**
- Consumes: `TranslationConfig`, `GuildConfig`, `StoreData` (`src/types/index.ts`, 변경 없음)
- Produces: `resetConfigCacheForTests(): void` — 테스트 전용 export

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/services/configService.test.ts` **맨 끝에** 다음 네 개를 덧붙인다:

```typescript
test('initialize drops translation entries that are missing fields', () => {
  const filePath = tempConfigPath();
  seed(filePath, {
    version: 1,
    guilds: {
      g1: {
        translations: [
          {
            id: 'cfg_good11',
            sourceChannelId: 's1',
            targetChannelId: 't1',
            targetLanguage: 'ko',
            createdAt: '2026-08-21T00:00:00.000Z',
          },
          { id: 'cfg_bad222', sourceChannelId: 's2' },
          null,
          'not an object',
        ],
      },
    },
  });

  configService.initialize(filePath);

  const list = configService.listTranslations('g1');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'cfg_good11');
});

test('a malformed entry does not stop the remaining settings from resolving', () => {
  const filePath = tempConfigPath();
  seed(filePath, {
    version: 1,
    guilds: {
      g1: {
        translations: [
          { id: 'cfg_bad222', targetLanguage: 'ko' },
          {
            id: 'cfg_good11',
            sourceChannelId: 's1',
            targetChannelId: 't1',
            targetLanguage: 'ko',
            createdAt: '2026-08-21T00:00:00.000Z',
          },
        ],
      },
    },
  });

  configService.initialize(filePath);

  const found = configService.findBySourceChannel('g1', 's1');
  assert.equal(found?.targetChannelId, 't1');
});

test('overwriting a setting keeps the original createdAt', () => {
  const filePath = tempConfigPath();
  seed(filePath, {
    version: 1,
    guilds: {
      g1: {
        translations: [
          {
            id: 'cfg_aaaaaa',
            sourceChannelId: 's1',
            targetChannelId: 't1',
            targetLanguage: 'ko',
            createdAt: '2020-01-01T00:00:00.000Z',
          },
        ],
      },
    },
  });
  configService.initialize(filePath);

  const result = configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't2',
    targetLanguage: 'ja',
  });

  assert.equal(result.setting.createdAt, '2020-01-01T00:00:00.000Z');
  assert.equal(result.setting.id, 'cfg_aaaaaa');
  assert.equal(result.setting.targetChannelId, 't2');
});

// 이 테스트는 모듈 수준 캐시를 비운다. 다른 테스트는 모두 스스로 initialize()를
// 먼저 부르므로 순서에 영향받지 않지만, 파일 맨 끝에 두어 의도를 분명히 한다.
test('listTranslations throws when initialize was never called', () => {
  configService.resetConfigCacheForTests();

  assert.throws(
    () => configService.listTranslations('g1'),
    /configService\.initialize\(\) must be called before use/
  );
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test 2>&1 | grep -A3 "not ok" | head -40`
Expected: 네 개 모두 실패. `resetConfigCacheForTests`는 존재하지 않아 타입 오류로, 나머지 셋은 단언 실패로 떨어진다.

- [ ] **Step 3: 원소 검증을 구현한다**

`src/services/configService.ts`의 `normalizeGuild`(8~13행)를 다음으로 교체한다:

```typescript
/**
 * 원소 하나가 망가져도 나머지 설정은 살린다. 사양서 4.2.1이 config.json 손편집을
 * 장점으로 광고하는 이상 필드가 빠진 원소는 실제로 도달 가능하고, 그대로 두면
 * 메시지를 처리하는 중에 터진다 — 기동 시점에 걸러내는 편이 낫다.
 */
function isTranslationConfig(raw: unknown): raw is TranslationConfig {
  if (typeof raw !== 'object' || raw === null) return false;
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.sourceChannelId === 'string' &&
    typeof candidate.targetChannelId === 'string' &&
    typeof candidate.targetLanguage === 'string' &&
    typeof candidate.createdAt === 'string'
  );
}

function normalizeGuild(guildId: string, raw: unknown): GuildConfig {
  const candidate = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<GuildConfig>;
  const source: unknown[] = Array.isArray(candidate.translations) ? candidate.translations : [];
  const translations = source.filter(isTranslationConfig);

  const dropped = source.length - translations.length;
  if (dropped > 0) {
    // 무엇이 어떻게 망가졌는지는 남기지 않는다. 개수와 길드 ID면 손편집한 사람이 찾아간다.
    console.error(
      `[configService] dropped ${dropped} malformed translation entries for guild ${guildId}`
    );
  }

  return { translations };
}
```

같은 파일 `normalize` 안의 호출부(25~27행)를 인자 순서에 맞게 고친다:

```typescript
  for (const [guildId, guildData] of Object.entries(rawGuilds)) {
    guilds[guildId] = normalizeGuild(guildId, guildData);
  }
```

- [ ] **Step 4: `createdAt` 보존을 구현한다**

같은 파일 `upsertTranslation` 안의 `setting` 리터럴에서 `createdAt` 줄을 바꾼다:

```typescript
  const setting: TranslationConfig = {
    id: replaced?.id ?? generateId(guild.translations),
    sourceChannelId: input.sourceChannelId,
    targetChannelId: input.targetChannelId,
    targetLanguage: input.targetLanguage,
    // 덮어쓰기는 새 설정이 아니라 같은 설정의 수정이다. id를 물려주는 것과 같은 이유로
    // createdAt도 물려준다 — 그러지 않으면 이름과 달리 "최종 수정 시각"이 된다.
    createdAt: replaced?.createdAt ?? new Date().toISOString(),
  };
```

- [ ] **Step 5: 테스트용 리셋을 추가한다**

같은 파일 `initialize` 함수 **바로 아래**에 덧붙인다:

```typescript
/** 모듈 수준 캐시가 테스트 사이에 새지 않도록 비운다. 운영 코드는 호출하지 않는다. */
export function resetConfigCacheForTests(): void {
  cache = undefined;
  storePath = CONFIG_PATH;
}
```

- [ ] **Step 6: 테스트 통과를 확인한다**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: 타입 오류 없음, `fail 0`, 106 → 110 tests

`[configService] dropped 3 malformed translation entries for guild g1` 같은 줄이 테스트 출력에 섞여 나오는 것은 정상이다 — 그 로그를 내는 것이 테스트의 목적 중 하나다.

- [ ] **Step 7: 커밋**

```bash
git add src/services/configService.ts src/services/configService.test.ts
git commit -m "fix: validate translation entries when loading the config

손편집으로 필드가 빠진 원소가 들어오면 기동 시점에 걸러내고 개수만 로그에
남긴다. 덮어쓰기 시 createdAt을 물려받게 해 필드 이름이 실제 의미와
일치하게 한다(디스크 호환을 위해 이름은 그대로 둔다)."
```

---

## Task 3: `setting.ts`의 중복 응답과 채널 라벨을 정리한다

**Files:**
- Modify: `src/commands/setting.ts`

**배경:** 순수 리팩터다. **동작이 바뀌면 안 된다** — 단 하나의 예외는 자동완성의 삭제된 채널 문구가 `(deleted <id>)`에서 `(deleted channel <id>)`로 통일되는 것이며, 이것이 통합의 목적이다.

정리 대상 셋:
1. `'This command can only be used inside a server.'` 응답 블록이 `handleRegister`·`handleList`·`handleRemove`에 그대로 세 번
2. `'Failed to save the setting. Check the server logs.'` 응답 블록이 두 번
3. `channelLabel`(멘션 형식)과 `nameOf`(이름 형식)가 같은 길드 캐시 조회를 따로 구현

**Interfaces:**
- Consumes: `listTranslations`, `removeTranslation`, `upsertTranslation`, `UpsertResult` (`configService`, 변경 없음)
- Produces: 없음 (모듈 내부 정리. `data`, `execute`, `autocomplete`, `LANGUAGE_LABELS` export는 그대로)

- [ ] **Step 1: 기존 테스트가 통과하는 상태를 확인한다**

Run: `npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: `fail 0`, 110 tests

이 태스크는 새 테스트를 추가하지 않는다. `setting.test.ts`는 커맨드 스키마(`data.toJSON()`)를 검증하며, 리팩터가 스키마를 건드리지 않았음을 이 테스트들이 보증한다. 핸들러 자체에 단위 테스트가 없는 것은 Phase 2에서 확정된 결정이다 — discord.js `ChatInputCommandInteraction`을 흉내 내려면 `as unknown as` 캐스트로 두 번째 미검사 이음매를 만들어야 하고, 그 비용이 얻는 것보다 크다.

- [ ] **Step 2: import에 `Guild` 타입을 추가하고 `invalidateWebhook`은 아직 건드리지 않는다**

`src/commands/setting.ts` 첫 import 블록의 타입 목록에 `Guild`를 넣는다:

```typescript
import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
```

- [ ] **Step 3: 공통 응답 헬퍼를 추가한다**

`languageLabel` 함수 **바로 위**에 다음을 넣는다:

```typescript
/** 설정 관련 응답은 전부 ephemeral이다 — 실행한 사람만 보면 된다. */
async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

const GUILD_ONLY = 'This command can only be used inside a server.';
const SAVE_FAILED = 'Failed to save the setting. Check the server logs.';

/**
 * 세 서브커맨드가 모두 같은 길드 전용 검사를 한다.
 * guildId와 guild를 함께 돌려주는 이유는 guildId만으로는 interaction.guild가
 * 좁혀지지 않아 호출부마다 두 번째 검사가 남기 때문이다.
 */
async function requireGuild(
  interaction: ChatInputCommandInteraction
): Promise<{ guildId: string; guild: Guild } | undefined> {
  if (interaction.guildId && interaction.guild) {
    return { guildId: interaction.guildId, guild: interaction.guild };
  }
  await replyEphemeral(interaction, GUILD_ONLY);
  return undefined;
}
```

- [ ] **Step 4: 채널 라벨을 통합한다**

`channelLabel` 함수(100~107행)를 통째로 다음으로 교체한다:

```typescript
/**
 * 멘션 표기와 이름 표기 모두 같은 길드 캐시 조회를 쓴다. 자동완성 목록에서는 채널
 * 멘션이 렌더링되지 않아 형식만 갈리므로, 조회와 삭제된 채널 문구는 여기서만 관리한다.
 */
function lookupChannel(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  channelId: string
): { name: string } | undefined {
  return interaction.guild?.channels.cache.get(channelId);
}

function deletedChannelLabel(channelId: string): string {
  return `(deleted channel ${channelId})`;
}

/** 채널이 아직 존재하면 멘션으로, 삭제됐으면 그 사실을 드러낸다. */
function channelMention(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  channelId: string
): string {
  return lookupChannel(interaction, channelId)
    ? `<#${channelId}>`
    : deletedChannelLabel(channelId);
}

/** 자동완성 목록용. 멘션이 렌더링되지 않으므로 채널 이름을 직접 넣는다. */
function channelName(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  channelId: string
): string {
  const channel = lookupChannel(interaction, channelId);
  return channel ? `#${channel.name}` : deletedChannelLabel(channelId);
}
```

바로 아래 `describe` 함수의 본문에서 `channelLabel`을 `channelMention`으로 바꾼다:

```typescript
function describe(
  interaction: ChatInputCommandInteraction,
  setting: Readonly<TranslationConfig>
): string {
  const source = channelMention(interaction, setting.sourceChannelId);
  const target = channelMention(interaction, setting.targetChannelId);
  return `${source} → ${target} (${languageLabel(setting.targetLanguage)})`;
}
```

- [ ] **Step 5: `handleRegister`를 헬퍼로 갈아끼운다**

`handleRegister`의 시작 부분(119~159행)에서 길드 검사와 그 뒤 채널 조회를 다음으로 바꾼다:

```typescript
async function handleRegister(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuild(interaction);
  if (!context) return;
  const { guildId, guild } = context;

  const sourceOption = interaction.options.getChannel('source-channel', true);
  const targetOption = interaction.options.getChannel('target-channel', true);
  const targetLanguage = interaction.options.getString('target-language', true);

  if (sourceOption.id === targetOption.id) {
    await replyEphemeral(
      interaction,
      'Source and output channels are the same. Please pick two different channels.'
    );
    return;
  }

  const botMember = guild.members.me;
  if (!botMember) {
    await replyEphemeral(interaction, 'Could not read bot information. Please try again in a moment.');
    return;
  }

  // getChannel의 반환 타입은 permissionsFor가 없는 형태를 포함하므로,
  // 길드 캐시에서 실제 채널 객체를 다시 얻는다.
  const sourceChannel = guild.channels.cache.get(sourceOption.id);
  const targetChannel = guild.channels.cache.get(targetOption.id);
  if (!sourceChannel || !targetChannel) {
    await replyEphemeral(
      interaction,
      'Could not read channel information. Please try again in a moment.'
    );
    return;
  }
```

권한 검사 블록(`const problems: string[] = [];` ~ `targetMissing` 계산)은 그대로 두고, 그 아래 `if (problems.length > 0)` 블록의 응답만 바꾼다:

```typescript
  if (problems.length > 0) {
    await replyEphemeral(
      interaction,
      [
        'Cannot register — the bot is missing permissions:',
        ...problems.map((problem) => `• ${problem}`),
        '',
        'Grant the permissions above and try again.',
      ].join('\n')
    );
    return;
  }
```

저장 블록의 catch와 마지막 응답도 바꾼다:

```typescript
  let result: UpsertResult;
  try {
    result = upsertTranslation(guildId, {
      sourceChannelId: sourceChannel.id,
      targetChannelId: targetChannel.id,
      targetLanguage,
    });
  } catch (error) {
    console.error('[setting] failed to save translation config', error);
    await replyEphemeral(interaction, SAVE_FAILED);
    return;
  }

  const content = result.replaced
    ? [
        `Updated the setting for <#${sourceChannel.id}>.`,
        `  Before: ${channelMention(interaction, result.replaced.targetChannelId)} (${languageLabel(result.replaced.targetLanguage)})`,
        `  After: ${channelMention(interaction, result.setting.targetChannelId)} (${languageLabel(result.setting.targetLanguage)})`,
      ].join('\n')
    : `Setting registered.\n  ${describe(interaction, result.setting)}`;

  await replyEphemeral(interaction, content);
}
```

- [ ] **Step 6: `handleList`와 `handleRemove`를 갈아끼운다**

`handleList` 전체를 다음으로 교체한다:

```typescript
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuild(interaction);
  if (!context) return;

  const settings = listTranslations(context.guildId);
  if (settings.length === 0) {
    await replyEphemeral(interaction, 'No settings registered yet. Use `/setting register` to add one.');
    return;
  }

  const LIST_LIMIT = 25;
  const shown = settings.slice(0, LIST_LIMIT);
  const lines = shown.map((setting) => `• ${describe(interaction, setting)}`);
  if (settings.length > shown.length) {
    lines.push(`…and ${settings.length - shown.length} more`);
  }
  await replyEphemeral(interaction, [`${settings.length} setting(s) registered:`, ...lines].join('\n'));
}
```

`handleRemove` 전체를 다음으로 교체한다:

```typescript
async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuild(interaction);
  if (!context) return;

  const id = interaction.options.getString('id', true);

  let removed: Readonly<TranslationConfig> | undefined;
  try {
    removed = removeTranslation(context.guildId, id);
  } catch (error) {
    console.error('[setting] failed to save translation config', error);
    await replyEphemeral(interaction, SAVE_FAILED);
    return;
  }

  if (!removed) {
    await replyEphemeral(interaction, 'Setting not found. It may already have been removed.');
    return;
  }

  await replyEphemeral(interaction, `Setting removed.\n  ${describe(interaction, removed)}`);
}
```

`execute`의 `default` 분기 응답도 헬퍼로 바꾼다:

```typescript
    default:
      console.error(`[setting] unknown subcommand: ${subcommand}`);
      await replyEphemeral(interaction, 'Unknown command.');
```

- [ ] **Step 7: `autocomplete`의 지역 함수를 제거한다**

`autocomplete` 안의 `nameOf` 지역 함수 정의(주석 포함 5줄)를 삭제하고, `choices` 생성에서 `nameOf(...)`를 `channelName(interaction, ...)`으로 바꾼다:

```typescript
    const focused = interaction.options.getFocused().toLowerCase();

    const choices = listTranslations(guildId)
      .map((setting) => ({
        name: `${channelName(interaction, setting.sourceChannelId)} → ${channelName(interaction, setting.targetChannelId)} (${languageLabel(setting.targetLanguage)})`.slice(
          0,
          100
        ),
        value: setting.id,
      }))
```

- [ ] **Step 8: 타입체크와 테스트를 돌린다**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: 타입 오류 없음, `fail 0`, 110 tests (증감 없음 — 순수 리팩터)

`grep -n "MessageFlags.Ephemeral" src/commands/setting.ts`로 확인했을 때 `replyEphemeral` 안의 한 곳만 남아야 한다.

- [ ] **Step 9: 커밋**

```bash
git add src/commands/setting.ts
git commit -m "refactor: collapse duplicated replies and channel labels in setting.ts

길드 전용 거부 응답 세 곳과 저장 실패 응답 두 곳을 헬퍼로 합치고, 멘션
표기와 이름 표기가 같은 길드 캐시 조회를 쓰게 한다. 자동완성의 삭제된 채널
문구가 '(deleted channel <id>)'로 통일된다."
```

---

## Task 4: 설정이 사라지면 Webhook 토큰을 들고 있지 않는다

**Files:**
- Modify: `src/commands/setting.ts`

**배경:** Phase 4는 Webhook 토큰을 디스크에 저장하지 않기로 했다 — 만료 없는 자격증명이므로 보유 시간을 최소화한다는 취지다. 그런데 `/setting remove`로 설정을 지워도 그 출력 채널의 Webhook이 메모리 캐시에 그대로 남아, 프로세스가 죽을 때까지 토큰을 들고 있다. 출력 채널을 다른 채널로 바꿔 재등록한 경우에도 이전 채널의 항목이 같은 이유로 남는다.

**백로그 항목의 확장:** 원래 백로그는 `/setting remove`만 적었지만, 재등록으로 출력 채널이 바뀌는 경로에 똑같은 누수가 있다. 같은 파일 같은 한 줄짜리 수정이므로 절반만 막지 않는다.

**Interfaces:**
- Consumes: `invalidateWebhook(channelId: string): void` (`src/services/webhookService.ts`, 변경 없음)
- Produces: 없음

- [ ] **Step 1: import를 추가한다**

`src/commands/setting.ts`의 `channelPermissions` import 블록 **아래**에 넣는다:

```typescript
import { invalidateWebhook } from '../services/webhookService';
```

- [ ] **Step 2: `handleRemove`에 무효화를 넣는다**

`handleRemove`의 `if (!removed) { ... }` 블록 **바로 아래**, 마지막 응답 **바로 위**에 넣는다:

```typescript
  // 설정이 사라지면 그 출력 채널의 Webhook 토큰을 메모리에 들고 있을 이유가 없다.
  // 같은 채널을 쓰는 설정이 남아 있어도 안전하다 — 캐시만 비우므로 다음 메시지가 다시 확보한다.
  invalidateWebhook(removed.targetChannelId);

  await replyEphemeral(interaction, `Setting removed.\n  ${describe(interaction, removed)}`);
```

- [ ] **Step 3: `handleRegister`에 무효화를 넣는다**

`handleRegister`에서 `upsertTranslation`의 `try/catch`가 끝난 **직후**, `const content = result.replaced` **바로 위**에 넣는다:

```typescript
  // 출력 채널이 바뀌면 이전 채널의 Webhook은 더 쓰지 않는다. 삭제와 같은 이유로 캐시를 비운다.
  if (result.replaced && result.replaced.targetChannelId !== result.setting.targetChannelId) {
    invalidateWebhook(result.replaced.targetChannelId);
  }
```

- [ ] **Step 4: 타입체크와 테스트를 돌린다**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: 타입 오류 없음, `fail 0`, 110 tests

**단위 테스트를 추가하지 않는다.** `invalidateWebhook`이 캐시를 비우고 다음 호출이 Webhook을 다시 확보한다는 것은 `webhookService.test.ts`가 Phase 4에서 이미 검증했다. 남은 것은 핸들러의 호출 한 줄이며, 그것을 테스트하려면 `ChatInputCommandInteraction`을 흉내 내야 한다 — Phase 2·4에서 비용 대비 얻는 것이 적다고 판단해 배제한 경로다. 대신 배포 후 수동 검증 목록에 시나리오를 추가한다(Task 7).

- [ ] **Step 5: 커밋**

```bash
git add src/commands/setting.ts
git commit -m "fix: drop the cached webhook when a setting stops using its channel

/setting remove와 출력 채널이 바뀌는 재등록에서 이전 채널의 Webhook 캐시를
비운다. 토큰 보유 시간을 최소화한다는 Phase 4의 결정을 설정 삭제 경로까지
일관되게 적용한다."
```

---

## Task 5: 번역 계층의 테스트 공백을 메운다

**Files:**
- Modify: `src/services/translationService.ts`
- Modify: `src/services/translationService.test.ts`
- Modify: `src/services/providers/google.test.ts`

**배경:** 세 가지 경로에 테스트가 없다.
1. `createTranslator`가 제공자의 **비-`Error` throw**를 `String(error)`로 처리하는 경로
2. `initializeTranslator`의 env 배선 — 어떤 키가 있을 때 어떤 제공자가 어떤 순서로 등록되는지
3. `FROM_GOOGLE`의 `zh`·`zh-Hans` 별칭 정규화

**Interfaces:**
- Consumes: `createTranslator`, `AllProvidersFailedError`, `initializeTranslator`, `translate`, `TranslationProvider`, `createGoogleProvider`
- Produces: `resetTranslatorForTests(): void` — 테스트 전용 export

- [ ] **Step 1: 테스트용 리셋을 추가한다**

`src/services/translationService.ts`의 `initializeTranslator` 함수 **바로 아래**(`translate` 위)에 넣는다:

```typescript
/** 모듈 수준 상태가 테스트 사이에 새지 않도록 비운다. 운영 코드는 호출하지 않는다. */
export function resetTranslatorForTests(): void {
  defaultTranslate = undefined;
}
```

- [ ] **Step 2: `translationService.test.ts`에 테스트를 덧붙인다**

먼저 import 줄을 다음으로 바꾼다:

```typescript
import {
  AllProvidersFailedError,
  createTranslator,
  initializeTranslator,
  resetTranslatorForTests,
  translate,
} from './translationService';
```

그리고 파일 **맨 끝에** 다음을 덧붙인다:

```typescript
/** process.env는 전역이다. 바꾼 값을 반드시 되돌린다. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** 어떤 제공자가 등록됐는지는 기동 로그가 유일하게 관찰 가능한 신호다. */
function captureLog(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test('a provider that throws a non-Error is still reported by name', async () => {
  const provider: TranslationProvider = {
    name: 'weird',
    translate: async () => {
      // 제공자가 Error가 아닌 값을 던지는 경우 (예: 라이브러리가 문자열을 throw)
      throw 'plain string failure';
    },
  };
  const translateOne = createTranslator([provider]);

  await assert.rejects(
    () => translateOne('hello', 'ko'),
    (error: unknown) => {
      assert.ok(error instanceof AllProvidersFailedError);
      assert.equal(error.attempts[0].provider, 'weird');
      assert.equal(error.attempts[0].message, 'plain string failure');
      return true;
    }
  );
});

test('initializeTranslator registers deepl before google when both keys are set', () => {
  const lines = withEnv({ DEEPL_API_KEY: 'deepl-key', GOOGLE_TRANSLATE_API_KEY: 'google-key' }, () =>
    captureLog(() => initializeTranslator())
  );

  assert.ok(
    lines.some((line) => line.includes('providers: deepl -> google')),
    lines.join('\n')
  );
});

test('initializeTranslator registers google alone when only its key is set', () => {
  const lines = withEnv({ DEEPL_API_KEY: undefined, GOOGLE_TRANSLATE_API_KEY: 'google-key' }, () =>
    captureLog(() => initializeTranslator())
  );

  assert.ok(
    lines.some((line) => line.includes('providers: google')),
    lines.join('\n')
  );
});

test('initializeTranslator treats a whitespace-only key as absent', () => {
  withEnv({ DEEPL_API_KEY: '   ', GOOGLE_TRANSLATE_API_KEY: undefined }, () => {
    assert.throws(() => initializeTranslator(), /DEEPL_API_KEY/);
  });
});

test('initializeTranslator throws when no provider key is configured', () => {
  withEnv({ DEEPL_API_KEY: undefined, GOOGLE_TRANSLATE_API_KEY: undefined }, () => {
    assert.throws(() => initializeTranslator(), /GOOGLE_TRANSLATE_API_KEY/);
  });
});

// 이 테스트는 모듈 수준 상태를 비운다. 스스로 리셋하므로 선언 순서에 의존하지 않는다.
test('translate throws before initializeTranslator has run', () => {
  resetTranslatorForTests();

  assert.throws(() => translate('hello', 'ko'), /initializeTranslator\(\) must be called/);
});
```

- [ ] **Step 3: `google.test.ts`에 별칭 테스트를 덧붙인다**

`src/services/providers/google.test.ts` **맨 끝에** 덧붙인다:

```typescript
test('a detected "zh" is normalized to the bot language code', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'hello', detectedSourceLanguage: 'zh' }] },
  });
  const provider = createGoogleProvider('key', impl);

  const result = await provider.translate('你好', 'en');

  assert.equal(result.detectedSourceLanguage, 'zh-CN');
});

test('a detected "zh-Hans" is normalized to the bot language code', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'hello', detectedSourceLanguage: 'zh-Hans' }] },
  });
  const provider = createGoogleProvider('key', impl);

  const result = await provider.translate('你好', 'en');

  assert.equal(result.detectedSourceLanguage, 'zh-CN');
});

test('a detected language with no alias is passed through unchanged', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'hello', detectedSourceLanguage: 'fr' }] },
  });
  const provider = createGoogleProvider('key', impl);

  const result = await provider.translate('bonjour', 'en');

  assert.equal(result.detectedSourceLanguage, 'fr');
});
```

- [ ] **Step 4: 타입체크와 테스트를 돌린다**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: 타입 오류 없음, `fail 0`, 110 → 119 tests

`[translation] weird failed: plain string failure` 같은 줄이 출력에 섞여 나오는 것은 정상이다.

- [ ] **Step 5: 커밋**

```bash
git add src/services/translationService.ts src/services/translationService.test.ts src/services/providers/google.test.ts
git commit -m "test: cover non-Error provider failures, env wiring, and zh aliases

제공자가 Error가 아닌 값을 던지는 경로, 어떤 키가 있을 때 어떤 제공자가
등록되는지, Google 감지 결과의 중국어 별칭 정규화에 테스트를 채운다."
```

---

## Task 6: pm2 설정 파일을 만든다

**Files:**
- Create: `ecosystem.config.js` (프로젝트 루트)

**배경:** 봇은 `.env`가 없거나 API 키가 하나도 없으면 기동 즉시 종료된다 — 번역할 수 없는 상태로 떠 있는 것보다 낫다는 의도된 동작이다. pm2 기본 설정은 이때 무한히 재시작을 시도하며 CPU를 태우고 로그를 채운다. 공유 vCPU 한 개인 e2-micro에서는 이것만으로 서버가 반응하지 않게 된다.

**Interfaces:**
- Consumes: `node_modules/ts-node/dist/bin.js`(ts-node CLI 진입점, `ts-node` 패키지의 `bin` 정의), `src/index.ts`
- Produces: 없음 (pm2가 읽는 설정 파일)

**타입체크 대상이 아니다:** `tsconfig.json`의 `include`가 `["src/**/*"]`이므로 루트의 `.js` 파일은 `tsc --noEmit`이 보지 않는다. 정상이다 — pm2가 CommonJS로 읽는 파일이다.

- [ ] **Step 1: 파일을 만든다**

`ecosystem.config.js`:

```javascript
// pm2 설정. 자격증명은 여기에 넣지 않는다 — 이 파일은 공개 저장소에 커밋되며,
// 토큰과 API 키는 서버의 .env에만 두고 dotenv가 읽는다(src/index.ts).
module.exports = {
  apps: [
    {
      name: 'discord-translation-bot',

      // ts-node CLI를 node로 직접 실행한다. npm을 거치면 pm2가 관리하는 대상이
      // npm 래퍼 프로세스가 되어 재시작과 시그널 전달이 한 단계 어긋난다.
      script: 'node_modules/ts-node/dist/bin.js',
      args: 'src/index.ts',

      // 인스턴스가 둘이면 같은 토큰으로 게이트웨이에 두 번 붙고 메시지가 두 번 게시된다.
      // 개발 중 실제로 겪은 문제라 fork/1을 명시적으로 못박는다.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,

      // .env가 없거나 API 키가 하나도 없으면 봇은 기동 즉시 종료된다(의도된 동작).
      // 기본 설정이면 pm2가 이것을 무한히 재시작하며 공유 vCPU 한 개를 태운다.
      // 60초를 못 버틴 기동이 5번 반복되면 포기하고 errored 상태로 남긴다.
      min_uptime: '60s',
      max_restarts: 5,
      restart_delay: 5000,

      // 누수가 있어도 RAM 1GB짜리 서버 전체를 끌어내리기 전에 프로세스만 재시작된다.
      max_memory_restart: '250M',

      // 로그 줄마다 타임스탬프. 로깅 라이브러리를 두지 않는 대신 pm2가 붙인다.
      time: true,
    },
  ],
};
```

- [ ] **Step 2: 파일이 유효한 CommonJS인지 확인한다**

Run: `node -e "const c=require('./ecosystem.config.js'); const a=c.apps[0]; console.log(a.name, a.script, a.instances, a.exec_mode, a.min_uptime, a.max_restarts, a.max_memory_restart, a.time)"`
Expected: `discord-translation-bot node_modules/ts-node/dist/bin.js 1 fork 60s 5 250M true`

- [ ] **Step 3: script 경로가 실제로 존재하는지 확인한다**

Run: `ls -l node_modules/ts-node/dist/bin.js`
Expected: 파일이 존재한다

**`pm2 start`를 실행하지 마라.** 봇이 게이트웨이에 붙어 백그라운드에 남는다. 이 설정의 검증은 사용자가 서버에서 직접 한다.

- [ ] **Step 4: 기존 테스트가 그대로인지 확인한다**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: 타입 오류 없음, `fail 0`, 119 tests

- [ ] **Step 5: 커밋**

```bash
git add ecosystem.config.js
git commit -m "feat: add pm2 ecosystem config

min_uptime과 max_restarts로 크래시 루프를 차단한다 — .env가 없으면 봇이
즉시 종료되는데 기본 설정이면 pm2가 무한히 재시작하며 공유 vCPU를 태운다.
instances 1 / fork 모드는 같은 토큰의 이중 접속을 막으려고 명시한다."
```

---

## Task 7: 배포 문서를 쓴다

**Files:**
- Create: `docs/deployment.md`

**배경:** GCP 인스턴스는 아직 없다. 이 문서는 사용자가 인스턴스를 만든 뒤 그대로 따라 할 수 있는 절차여야 한다. 설계서 §3.1이 담아야 할 12가지를 정한다.

**Interfaces:**
- Consumes: `ecosystem.config.js`(Task 6), `.env.example`의 변수 이름, `package.json`의 `deploy-commands` 스크립트
- Produces: 없음 (문서)

**정확성 주의:** `npm run deploy-commands`는 **길드 단위**로 등록한다(`src/deploy-commands.ts`가 `Routes.applicationGuildCommands`를 쓴다). `DISCORD_TOKEN`·`DISCORD_CLIENT_ID`·`DISCORD_TEST_GUILD_ID` 셋이 모두 있어야 하며, 하나라도 없으면 던진다. 변수 이름이 `TEST`지만 실제로는 봇을 쓸 서버의 ID를 넣는다 — 길드 등록은 즉시 반영되고 글로벌 등록은 최대 1시간이 걸린다. 문서에 이 사실을 그대로 적는다.

- [ ] **Step 1: 문서를 만든다**

`docs/deployment.md`:

````markdown
# 배포 가이드 — GCP e2-micro

이 문서는 봇을 GCP e2-micro 인스턴스에 올려 24시간 돌리는 절차다. 로컬 실행 방법은 `README.md`를 본다.

## 0. 준비

- Discord Developer Portal에서 봇 애플리케이션이 만들어져 있고 토큰을 발급받았다
- **MESSAGE CONTENT INTENT**가 켜져 있다 (Bot 탭 → Privileged Gateway Intents). 없으면 메시지 내용 자체가 들어오지 않는다
- 봇이 서버에 초대되어 있다 (OAuth2 스코프 `bot`, `applications.commands`)
- DeepL 또는 Google Cloud Translation 중 최소 하나의 API 키가 있다

## 1. 인스턴스 생성

GCP Compute Engine에서 VM을 만든다.

| 항목 | 값 |
|---|---|
| 머신 타입 | `e2-micro` |
| 리전 | `us-west1` / `us-central1` / `us-east1` 중 하나 |
| 부팅 디스크 | Debian 12, 30GB 표준 영구 디스크 |

**리전이 셋으로 제한되는 이유**: Always Free 한도가 이 세 리전에서만 적용된다. 다른 리전을 고르면 과금된다.

**방화벽 규칙은 열지 않는다.** 봇은 디스코드 게이트웨이와 번역 API로 나가는 연결만 쓴다. 들어오는 포트가 필요 없다.

## 2. Node.js 22 설치

SSH로 접속한 뒤:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v    # v22.x 이상인지 확인
```

## 3. 저장소 clone

```bash
cd ~
git clone https://github.com/gail5135/discord-translation-bot.git
cd discord-translation-bot
```

## 4. 의존성 설치

```bash
npm ci
```

`npm ci`가 메모리 부족으로 죽으면 스왑을 잡고 다시 시도한다. e2-micro는 RAM이 약 1GB뿐이다:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. `.env` 작성

**`.env`는 저장소에 없다.** 자격증명이 들어가므로 `.gitignore` 대상이며, 서버에서 직접 만든다.

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

| 변수 | 내용 |
|---|---|
| `DISCORD_TOKEN` | Developer Portal → Bot → Token |
| `DISCORD_CLIENT_ID` | Developer Portal → General Information → Application ID |
| `DISCORD_TEST_GUILD_ID` | 봇을 쓸 **서버(길드) ID**. 슬래시 커맨드 등록 대상이다 |
| `DEEPL_API_KEY` | 1순위 제공자. 무료 키는 `:fx`로 끝나며 엔드포인트는 코드가 자동 판별한다 |
| `GOOGLE_TRANSLATE_API_KEY` | 2순위 제공자 |

번역 API 키는 **둘 중 하나만 있어도 기동한다.** 둘 다 없으면 기동 즉시 종료된다.

`chmod 600`은 반드시 실행한다. 코드가 쓰는 `config.json`에는 자동으로 적용되지만 `.env`는 사람이 만드는 파일이다.

## 6. 슬래시 커맨드 등록

```bash
npm run deploy-commands
```

`Registered 1 command(s) to guild <id>` 가 나오면 성공이다.

**길드 단위 등록이다.** 즉시 반영된다(글로벌 등록은 최대 1시간). `DISCORD_TOKEN`·`DISCORD_CLIENT_ID`·`DISCORD_TEST_GUILD_ID` 셋이 모두 있어야 하며, 하나라도 비어 있으면 오류를 던지고 끝난다.

이 명령은 **커맨드 정의가 바뀌었을 때만** 다시 실행하면 된다. 봇을 재시작할 때마다 부를 필요는 없다.

## 7. pm2 설치와 기동

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 logs --lines 50
```

로그에 다음 두 줄이 보이면 정상이다:

```
[translation] providers: deepl -> google
Logged in as <봇이름>#0000
```

## 8. 로그 로테이션 (필수)

pm2는 기본적으로 로그를 무한히 쌓는다. 디스크 30GB를 채우면 죽는 것은 봇이 아니라 서버다 — 그 상태에서는 SSH 접속도 어려워진다.

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

`pm2-logrotate`는 pm2 자체 모듈이라 `package.json`과 무관하다.

## 9. 부팅 시 자동 시작

```bash
pm2 startup systemd
```

출력된 `sudo env PATH=... pm2 startup systemd -u ...` 명령을 그대로 복사해 실행한 뒤:

```bash
pm2 save
```

`pm2 save`를 빠뜨리면 재부팅 후 pm2는 뜨지만 봇은 뜨지 않는다.

## 10. 갱신 절차

```bash
cd ~/discord-translation-bot
git pull
npm ci
pm2 restart discord-translation-bot
```

슬래시 커맨드 정의(`src/commands/setting.ts`의 `data`)가 바뀐 경우에만 추가로:

```bash
npm run deploy-commands
```

## 11. 롤백 절차

```bash
cd ~/discord-translation-bot
git log --oneline -10          # 되돌릴 커밋 확인
git checkout <이전 커밋 해시>
npm ci
pm2 restart discord-translation-bot
```

`.env`와 `config.json`은 gitignore 대상이라 `git checkout`의 영향을 받지 않는다. 설정은 그대로 유지된다.

되돌린 뒤 `git checkout main`으로 복귀할 수 있다.

## 12. 배포 체크리스트

기동 직후 확인한다.

- [ ] Developer Portal에서 **MESSAGE CONTENT INTENT**가 켜져 있다
- [ ] 봇이 원본 채널에 **View Channel** 권한을 갖고 있다
- [ ] 봇이 출력 채널에 **View Channel / Send Messages / Manage Webhooks** 권한을 갖고 있다
- [ ] `ls -l .env`의 권한이 `-rw-------` (600)이다
- [ ] `pm2 logs`에 `[translation] providers: ...`와 `Logged in as ...`가 보인다
- [ ] `pm2 status`가 `online`이다
- [ ] `pm2 ls`에 `pm2-logrotate`가 보인다
- [ ] `pm2 save`를 실행했다
- [ ] 원본 채널에 메시지를 보내면 출력 채널에 **원 발신자 이름·아바타**로 게시된다
- [ ] `pm2 logs`에 메시지 본문이 남지 않는다

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| `pm2 status`가 `errored` | `pm2 logs --err`. `.env` 누락이나 키 부재가 대부분이다. 60초 안에 5번 죽으면 pm2가 포기하므로, 고친 뒤 `pm2 restart`가 아니라 `pm2 start ecosystem.config.js`로 카운터를 초기화한다 |
| 슬래시 커맨드가 안 보임 | `npm run deploy-commands`를 실행했는지, `DISCORD_TEST_GUILD_ID`가 그 서버의 ID인지 |
| 메시지를 감지하지 못함 | MESSAGE CONTENT INTENT, 원본 채널의 View Channel 권한 |
| 봇 이름으로 게시됨 (원 발신자가 아니라) | 출력 채널의 Manage Webhooks 권한 |
| 같은 메시지가 두 번 게시됨 | 봇이 두 곳에서 돌고 있다. 로컬에서도 켜뒀는지 확인한다 |
| 디스크가 찼다 | `pm2 install pm2-logrotate`를 빠뜨렸다. 8절을 실행하고 `pm2 flush`로 기존 로그를 비운다 |
````

- [ ] **Step 2: 문서 안의 명령이 저장소 사실과 맞는지 확인한다**

Run:
```bash
grep -n "applicationGuildCommands" src/deploy-commands.ts
grep -n "DISCORD_TEST_GUILD_ID" src/deploy-commands.ts .env.example
grep -c "deploy-commands" package.json
ls -l node_modules/ts-node/dist/bin.js
```
Expected: 길드 등록임이 확인되고, 세 env 변수 이름이 `.env.example`과 일치하며, `deploy-commands` 스크립트가 존재한다.

- [ ] **Step 3: 커밋**

```bash
git add docs/deployment.md
git commit -m "docs: add GCP e2-micro deployment guide

인스턴스 생성부터 기동까지의 절차, 갱신·롤백, 배포 체크리스트를 담는다.
로그 로테이션은 선택이 아니라 필수 단계로 넣는다 — 디스크가 차면 죽는 것은
봇이 아니라 서버다."
```

---

## Task 8: README를 쓰고 문서 상태를 맞춘다

**Files:**
- Create: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-21-phase5-stabilization-deployment-design.md`

**배경:** 저장소는 **공개**된다. README가 첫 화면이다. 안전성 확인은 이미 끝났다 — `.env`와 `src/store/config.json`은 전체 히스토리에서 한 번도 커밋된 적이 없고, 추적 파일에 실제 Discord ID가 없다. README에 실제 토큰·키·서버 ID를 쓰지 마라.

**Interfaces:**
- Consumes: `docs/deployment.md`(Task 7), `.env.example`
- Produces: 없음 (문서)

- [ ] **Step 1: `README.md`를 만든다**

````markdown
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
| SERVER MEMBERS INTENT | 권장 — 서버 별명 표시에 씁니다 |

**OAuth2 스코프**: `bot`, `applications.commands`

**봇 권한**

| 권한 | 어디에 |
|---|---|
| View Channel | 원본 채널, 출력 채널 |
| Send Messages | 출력 채널 |
| Manage Webhooks | 출력 채널 — 원 발신자 명의 게시에 필요합니다 |
| Read Message History, Embed Links | 출력 채널 |

권한이 부족하면 `/setting register`가 무엇이 없는지 알려주고 등록을 거부합니다.

## 로컬 실행

```bash
git clone https://github.com/gail5135/discord-translation-bot.git
cd discord-translation-bot
npm ci

cp .env.example .env
# .env를 열어 값을 채웁니다
chmod 600 .env

npm run deploy-commands   # 슬래시 커맨드 등록 (커맨드가 바뀔 때만 다시 실행)
npm start
```

**`.env`는 저장소에 없습니다.** 자격증명이 들어가므로 `.gitignore` 대상이며, 직접 만들어야 합니다. `.env.example`이 필요한 변수 목록입니다.

| 변수 | 내용 |
|---|---|
| `DISCORD_TOKEN` | 봇 토큰 |
| `DISCORD_CLIENT_ID` | 애플리케이션 ID |
| `DISCORD_TEST_GUILD_ID` | 슬래시 커맨드를 등록할 서버 ID (길드 등록은 즉시 반영됩니다) |
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

서버별 채널·언어 설정은 `src/store/config.json`에 JSON으로 저장됩니다 (gitignore 대상). 구동 시 메모리에 캐시하고, 슬래시 커맨드로 변경될 때만 파일에 씁니다.

**이 파일에 자격증명은 없습니다.** API 키는 `.env`에 있고, Webhook 토큰은 아예 저장하지 않습니다(메모리 캐시만, 재시작 시 재조회).

쓰기는 임시 파일에 기록한 뒤 교체하는 원자적 쓰기이며, 교체 직전 기존 파일을 `config.json.bak`으로 백업합니다. 손상이 감지되면 백업으로 폴백합니다. 손으로 편집해도 되지만, 필드가 빠진 항목은 기동 시 걸러지고 로그에 개수가 남습니다.

## 개발

```bash
npm test         # node:test 단위 테스트
npm run typecheck   # tsc --noEmit
```

빌드 단계가 없습니다. ts-node로 직접 실행합니다.

## 배포

GCP e2-micro(Always Free)에 pm2로 올리는 절차는 [`docs/deployment.md`](docs/deployment.md)에 있습니다.

## 문서

| 문서 | 내용 |
|---|---|
| [`docs/discord-translation-bot-spec.md`](docs/discord-translation-bot-spec.md) | 기획 및 사양서 |
| [`docs/discord-translation-bot-dev-plan.md`](docs/discord-translation-bot-dev-plan.md) | 개발 계획서 |
| [`docs/deployment.md`](docs/deployment.md) | 배포 가이드 |
| [`docs/superpowers/specs/`](docs/superpowers/specs/) | Phase별 설계서 — 결정 근거와 배제한 대안 |
````

- [ ] **Step 2: `CLAUDE.md`의 Phase 상태를 갱신한다**

`## 구현 순서 (Phase)` 절에서 `현재 **Phase 4 완료** 상태입니다`로 시작하는 문단을 찾아, 그 문단 **바로 아래**의 구현 목록 끝(`아직 없는 것: pm2 배포와 에러 핸들링 정비(Phase 5).` 줄)을 다음으로 교체한다:

```markdown
- **배포 준비물** — `ecosystem.config.js`(pm2 — 크래시 루프 차단, 단일 인스턴스 고정), `docs/deployment.md`(GCP e2-micro 절차·갱신·롤백·체크리스트), `README.md`

Phase 5의 코드·문서 작업은 끝났습니다. 남은 것은 사용자가 GCP 인스턴스를 만든 뒤 수행하는 **배포와 수동 검증**입니다 — 설계서 §5 참고.
```

같은 절 첫 줄의 `현재 **Phase 4 완료** 상태입니다`를 `현재 **Phase 5 코드·문서 완료** 상태입니다(배포 전)`로 바꾼다. 괄호 안의 Phase 4 수동 검증 기록은 그대로 둔다.

- [ ] **Step 3: 설계서 §5에 수동 검증 시나리오를 하나 추가한다**

Task 4가 단위 테스트 없이 넘긴 경로를 배포 후 확인 목록에 남긴다. `docs/superpowers/specs/2026-08-21-phase5-stabilization-deployment-design.md`의 `### 수동 검증 시나리오` 목록에서 `7. \`ls -l .env\`로 권한이 \`600\`인지 확인` 줄 **아래**에 덧붙인다:

```markdown
8. `/setting remove` 후 같은 출력 채널로 다시 `/setting register` → 정상 게시(Webhook 캐시 무효화 경로. 단위 테스트가 없는 유일한 백로그 수정이다)
```

- [ ] **Step 4: 마지막 확인**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: 타입 오류 없음, `fail 0`, 119 tests

Run: `git status --short`
Expected: 추적 대상 변경분이 모두 스테이징 가능한 상태. `docs/presentation.html`과 `docs/project-introduction.md`는 사용자가 만든 미추적 파일이므로 **건드리지 마라.**

- [ ] **Step 5: 커밋**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-08-21-phase5-stabilization-deployment-design.md
git commit -m "docs: add README and mark Phase 5 code/docs complete

공개 저장소 첫 화면으로 무엇을 하는 봇인지, 필요한 Discord 설정과 권한,
로컬 실행 방법을 담는다. .env가 저장소에 없다는 사실과 그 이유를 명시한다."
```

---

## 완료 조건

- `npm test` — 119개 전부 통과 (Phase 4의 100개 + 이번 19개)
- `npm run typecheck` — 오류 없음
- `ecosystem.config.js`, `docs/deployment.md`, `README.md` 작성 완료
- 이월 백로그(설계서 §2.5) 전부 닫힘
- `CLAUDE.md` Phase 상태 갱신

**이 계획의 범위 밖**: GCP 인스턴스 생성, 실제 배포, 설계서 §5의 수동 검증. 사용자가 서버를 만든 뒤에 한다.
