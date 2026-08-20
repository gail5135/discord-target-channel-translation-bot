# Phase 4 (Webhook 기반 원 발신자 명의 게시) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 번역 메시지를 봇 명의가 아니라 원 발신자의 이름·아바타로 게시하고, 첨부파일을 전달한다. 이 프로젝트의 핵심 차별점을 완성한다.

**Architecture:** `webhookIdentity`는 Discord `username` 제약에 맞게 이름을 다듬는 순수 함수다. `webhookService`는 출력 채널별 Webhook을 확보해 메모리 Map에 캐싱하며, discord.js 채널 타입이 아니라 최소 인터페이스만 요구해 fake로 테스트한다. `messageCreate.ts`의 `postTranslation` 한 곳만 Webhook 전송으로 교체되고, 번역·큐·분할 로직은 손대지 않는다. 쓰지 않기로 확정된 `webhookCache` 필드와 타입은 삭제한다.

**Tech Stack:** TypeScript, Node.js 22+, discord.js v14.27, ts-node, Node 내장 테스트 러너(`node:test` + `node:assert/strict`)

## Global Constraints

- 설계 근거는 `docs/superpowers/specs/2026-08-20-phase4-webhook-identity-design.md`, 제품 규칙은 `docs/discord-translation-bot-spec.md` §4.4·§4.5
- **Webhook 토큰을 디스크에 저장하지 않는다.** 메모리 Map만 사용하며 봇 재시작 시 재조회·재생성 — 설계서 §2.1
- **봇이 소유한 Webhook만 사용한다** (`owner.id === client.user.id`). 남이 만든 Webhook을 빌려 쓰지 않는다 — 설계서 §2.1
- Webhook 전송 실패 시 해당 채널의 캐시를 **무효화**하고 그 메시지는 포기한다. 재시도하지 않는다 — 설계서 §2.3
- **첨부파일은 링크로만 전달한다.** 내려받아 재업로드하지 않는다(월 1GB egress) — 설계서 §2.4
- **본문 없이 첨부만 있는 메시지도 전달**하되 번역 API는 호출하지 않는다 — 설계서 §2.5
- 번역 전부 실패 알림은 **봇 명의**로 게시한다(Webhook 아님) — 설계서 §2.6
- Webhook 확보 실패 시 **봇 명의 게시로 폴백**한다. 이때만 작성자 이름을 본문 첫 줄에 굵게 넣는다 — 설계서 §2.7
- Webhook `username`은 1~80자, `discord`/`clyde` 포함 불가, `everyone`/`here` 불가 — 설계서 §2.8
- 게시 시 멘션이 다시 울리지 않아야 한다(`allowedMentions: { parse: [] }`) — Phase 3에서 확립
- 2000자 초과 시 분할, 원문 링크는 마지막 조각에만 — 기존 `splitForDiscord` 재사용
- 사용자에게 보이는 문구는 **영어**. 코드 주석은 한국어 — CLAUDE.md
- **새 npm 패키지를 설치하지 않는다** — CLAUDE.md
- 커밋 시 `git add -A`/`git add .` 금지, 파일 경로 명시
- **`npm start`와 `npm run deploy-commands`를 실행하지 말 것.** 실제 Discord 게이트웨이에 접속해 무한 대기하므로 세션이 멈춘다. `npm test`, `npm run typecheck`은 안전하다

---

## Task 1: Webhook 사용자 이름 정제

**Files:**
- Create: `src/services/webhookIdentity.ts`
- Test: `src/services/webhookIdentity.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `sanitizeWebhookUsername(preferred: string, fallback: string): string` — `src/services/webhookIdentity.ts`
- Task 3의 `messageCreate`가 `sanitizeWebhookUsername(member?.displayName ?? '', author.username)` 형태로 호출한다

Discord Webhook `username` 제약을 어기면 전송이 400으로 실패한다. 사용자가 정한 별명은 봇이 통제할 수 없으므로 방어가 필요하다.

규칙: 1~80자, `discord`/`clyde`(대소문자 무관) 포함 불가, `everyone`/`here` 불가.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/webhookIdentity.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeWebhookUsername } from './webhookIdentity';

test('keeps an ordinary name unchanged', () => {
  assert.equal(sanitizeWebhookUsername('YomaNezz', 'yoma'), 'YomaNezz');
});

test('falls back when the preferred name is empty', () => {
  assert.equal(sanitizeWebhookUsername('', 'yoma'), 'yoma');
  assert.equal(sanitizeWebhookUsername('   ', 'yoma'), 'yoma');
});

test('falls back to Unknown when both names are unusable', () => {
  assert.equal(sanitizeWebhookUsername('', ''), 'Unknown');
});

test('truncates to 80 characters', () => {
  const result = sanitizeWebhookUsername('a'.repeat(120), 'fallback');

  assert.equal(result.length, 80);
});

test('strips the forbidden substring discord', () => {
  const result = sanitizeWebhookUsername('discord-fan', 'fallback');

  assert.ok(!/discord/i.test(result), `still contains discord: ${result}`);
});

test('strips the forbidden substring regardless of case', () => {
  const result = sanitizeWebhookUsername('DiScOrD hater', 'fallback');

  assert.ok(!/discord/i.test(result), `still contains discord: ${result}`);
});

test('strips the forbidden substring clyde', () => {
  const result = sanitizeWebhookUsername('clyde2', 'fallback');

  assert.ok(!/clyde/i.test(result), `still contains clyde: ${result}`);
});

test('rejects the reserved names everyone and here', () => {
  assert.equal(sanitizeWebhookUsername('everyone', 'fallback'), 'fallback');
  assert.equal(sanitizeWebhookUsername('here', 'fallback'), 'fallback');
  assert.equal(sanitizeWebhookUsername('HERE', 'fallback'), 'fallback');
});

test('falls back when stripping leaves nothing usable', () => {
  // 'discord'만으로 이루어진 이름은 제거 후 빈 문자열이 된다
  assert.equal(sanitizeWebhookUsername('discord', 'fallback'), 'fallback');
});

test('falls back to Unknown when the fallback is also unusable', () => {
  assert.equal(sanitizeWebhookUsername('discord', 'clyde'), 'Unknown');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './webhookIdentity'`

- [ ] **Step 3: 구현**

`src/services/webhookIdentity.ts`:

```typescript
/** Discord Webhook username 상한 */
const MAX_USERNAME = 80;

/** Discord가 Webhook username에 허용하지 않는 부분 문자열 */
const FORBIDDEN_SUBSTRINGS = /discord|clyde/gi;

/** Discord가 Webhook username으로 허용하지 않는 예약어 */
const RESERVED = new Set(['everyone', 'here']);

/** 제약에 맞게 다듬는다. 사용할 수 없는 이름이면 빈 문자열을 돌려준다. */
function clean(name: string): string {
  const stripped = name.replace(FORBIDDEN_SUBSTRINGS, '').trim();
  if (stripped.length === 0) return '';
  if (RESERVED.has(stripped.toLowerCase())) return '';
  return stripped.slice(0, MAX_USERNAME);
}

/**
 * 서버 별명을 우선 쓰되 Webhook username 제약에 맞게 정제한다.
 * 별명이 쓸 수 없으면 계정명, 그것도 안 되면 'Unknown'으로 떨어진다.
 * 제약을 어기면 전송이 400으로 실패하는데, 사용자가 정한 별명은 봇이 통제할 수 없다.
 */
export function sanitizeWebhookUsername(preferred: string, fallback: string): string {
  return clean(preferred) || clean(fallback) || 'Unknown';
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 기존 73개 + 이번 10개 = 83개 통과

- [ ] **Step 5: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 6: Commit**

```bash
git add src/services/webhookIdentity.ts src/services/webhookIdentity.test.ts
git commit -m "feat: sanitize author names for webhook usernames"
```

---

## Task 2: Webhook 확보와 메모리 캐시

**Files:**
- Create: `src/services/webhookService.ts`
- Test: `src/services/webhookService.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `interface WebhookLike { id: string; owner: { id: string } | null; send(options: WebhookSendOptions): Promise<unknown> }`
  - `interface WebhookSendOptions { content: string; username: string; avatarURL?: string; allowedMentions: { parse: [] } }`
  - `interface WebhookHost { id: string; fetchWebhooks(): Promise<{ find(fn: (w: WebhookLike) => boolean): WebhookLike | undefined }>; createWebhook(options: { name: string }): Promise<WebhookLike> }`
  - `getWebhook(channel: WebhookHost, botUserId: string): Promise<WebhookLike | undefined>`
  - `invalidateWebhook(channelId: string): void`
  - `resetWebhookCacheForTests(): void`
  - Task 3의 `messageCreate`가 `getWebhook`과 `invalidateWebhook`을 쓴다

discord.js `TextChannel` 전체가 아니라 필요한 것만 요구한다. `channelPermissions`가 채널 대신 이미 계산된 권한 객체를 받는 것과 같은 원칙이다 — fake 객체 몇 줄로 단위 테스트가 된다. 실제 `TextChannel.fetchWebhooks()`는 `Collection`을 돌려주고 `Collection`은 `find`를 가지므로 구조적으로 호환된다.

`resetWebhookCacheForTests`는 모듈 수준 Map 때문에 테스트가 서로 간섭하지 않도록 두는 것이다. 운영 코드는 호출하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/webhookService.test.ts`:

```typescript
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getWebhook,
  invalidateWebhook,
  resetWebhookCacheForTests,
  type WebhookHost,
  type WebhookLike,
} from './webhookService';

const BOT_ID = 'bot-1';

function webhook(id: string, ownerId: string | null): WebhookLike {
  return {
    id,
    owner: ownerId === null ? null : { id: ownerId },
    send: async () => undefined,
  };
}

/**
 * fetchWebhooks/createWebhook 호출 횟수를 세는 최소 채널.
 * 카운터를 host 밖에 두는 이유는, host 안에 두고 메서드에서 host.fetchCount를 참조하면
 * TypeScript가 자기 자신을 참조하는 초기화자에서 타입을 추론하지 못해 컴파일이 깨지기 때문이다.
 */
function fakeChannel(
  channelId: string,
  existing: WebhookLike[]
): { host: WebhookHost; counts: { fetch: number; create: number } } {
  const counts = { fetch: 0, create: 0 };
  const host: WebhookHost = {
    id: channelId,
    async fetchWebhooks() {
      counts.fetch += 1;
      return {
        find: (fn: (w: WebhookLike) => boolean) => existing.find(fn),
      };
    },
    async createWebhook() {
      counts.create += 1;
      const created = webhook(`created-${channelId}`, BOT_ID);
      existing.push(created);
      return created;
    },
  };
  return { host, counts };
}

beforeEach(() => {
  resetWebhookCacheForTests();
});

test('creates a webhook when the channel has none', async () => {
  const { host, counts } = fakeChannel('c1', []);

  const result = await getWebhook(host, BOT_ID);

  assert.equal(result?.id, 'created-c1');
  assert.equal(counts.create, 1);
});

test('reuses a webhook the bot already owns', async () => {
  const { host, counts } = fakeChannel('c1', [webhook('existing', BOT_ID)]);

  const result = await getWebhook(host, BOT_ID);

  assert.equal(result?.id, 'existing');
  assert.equal(counts.create, 0);
});

test('ignores webhooks owned by someone else', async () => {
  const { host, counts } = fakeChannel('c1', [webhook('theirs', 'other-bot')]);

  const result = await getWebhook(host, BOT_ID);

  assert.equal(result?.id, 'created-c1', 'must not borrow another owner webhook');
  assert.equal(counts.create, 1);
});

test('ignores webhooks with no owner', async () => {
  const { host } = fakeChannel('c1', [webhook('ownerless', null)]);

  const result = await getWebhook(host, BOT_ID);

  assert.equal(result?.id, 'created-c1');
});

test('caches so the second call does not hit the api', async () => {
  const { host, counts } = fakeChannel('c1', []);

  await getWebhook(host, BOT_ID);
  await getWebhook(host, BOT_ID);

  assert.equal(counts.fetch, 1);
  assert.equal(counts.create, 1);
});

test('different channels are cached independently', async () => {
  const first = fakeChannel('c1', []);
  const second = fakeChannel('c2', []);

  const a = await getWebhook(first.host, BOT_ID);
  const b = await getWebhook(second.host, BOT_ID);

  assert.equal(a?.id, 'created-c1');
  assert.equal(b?.id, 'created-c2');
});

test('invalidate forces the next call to fetch again', async () => {
  const { host, counts } = fakeChannel('c1', []);
  await getWebhook(host, BOT_ID);

  invalidateWebhook('c1');
  await getWebhook(host, BOT_ID);

  assert.equal(counts.fetch, 2);
});

test('returns undefined when fetching throws', async () => {
  const channel: WebhookHost = {
    id: 'c1',
    fetchWebhooks: async () => {
      throw new Error('Missing Permissions');
    },
    createWebhook: async () => webhook('never', BOT_ID),
  };

  assert.equal(await getWebhook(channel, BOT_ID), undefined);
});

test('returns undefined when creating throws', async () => {
  const channel: WebhookHost = {
    id: 'c1',
    fetchWebhooks: async () => ({ find: () => undefined }),
    createWebhook: async () => {
      throw new Error('Missing Permissions');
    },
  };

  assert.equal(await getWebhook(channel, BOT_ID), undefined);
});

test('a failed lookup is not cached', async () => {
  let shouldFail = true;
  const channel: WebhookHost = {
    id: 'c1',
    fetchWebhooks: async () => {
      if (shouldFail) throw new Error('Missing Permissions');
      return { find: () => webhook('recovered', BOT_ID) };
    },
    createWebhook: async () => webhook('never', BOT_ID),
  };

  assert.equal(await getWebhook(channel, BOT_ID), undefined);
  shouldFail = false;
  assert.equal((await getWebhook(channel, BOT_ID))?.id, 'recovered');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './webhookService'`

- [ ] **Step 3: 구현**

`src/services/webhookService.ts`:

```typescript
export interface WebhookSendOptions {
  content: string;
  username: string;
  avatarURL?: string;
  allowedMentions: { parse: [] };
}

export interface WebhookLike {
  id: string;
  owner: { id: string } | null;
  send(options: WebhookSendOptions): Promise<unknown>;
}

/**
 * discord.js TextChannel이 만족하는 최소 형태.
 * 전체 타입을 요구하면 테스트가 무거운 목을 만들어야 한다.
 */
export interface WebhookHost {
  id: string;
  fetchWebhooks(): Promise<{ find(fn: (w: WebhookLike) => boolean): WebhookLike | undefined }>;
  createWebhook(options: { name: string }): Promise<WebhookLike>;
}

/** 생성 시 붙는 이름. 전송할 때마다 username으로 덮어쓰므로 표시에는 거의 쓰이지 않는다. */
const WEBHOOK_NAME = 'Translation Bot';

/**
 * 채널별 Webhook 캐시. 디스크에 저장하지 않는다 —
 * Webhook 토큰은 id와 함께 있으면 봇 인증 없이 그 채널에 게시할 수 있는 자격증명이다.
 * 재시작 시 다시 확보하는 비용(채널당 1회 API 호출)이 훨씬 싸다.
 */
const cache = new Map<string, WebhookLike>();

export async function getWebhook(
  channel: WebhookHost,
  botUserId: string
): Promise<WebhookLike | undefined> {
  const cached = cache.get(channel.id);
  if (cached) return cached;

  try {
    const webhooks = await channel.fetchWebhooks();
    // 남이 만든 Webhook을 빌려 쓰면 그 소유자가 지웠을 때 조용히 깨진다. 봇 소유만 쓴다.
    const own = webhooks.find((w) => w.owner?.id === botUserId);
    const webhook = own ?? (await channel.createWebhook({ name: WEBHOOK_NAME }));
    cache.set(channel.id, webhook);
    return webhook;
  } catch (error) {
    // 실패는 캐시하지 않는다. 권한이 복구되면 다음 메시지가 다시 시도한다.
    console.error(`[webhook] could not obtain a webhook for channel ${channel.id}`, error);
    return undefined;
  }
}

/**
 * 전송이 실패하면 호출한다. 관리자가 Webhook을 삭제한 경우가 대표적이며,
 * 캐시만 비우면 다음 메시지가 자연히 재생성한다. 재시도 경로를 따로 두지 않는다.
 */
export function invalidateWebhook(channelId: string): void {
  cache.delete(channelId);
}

/** 모듈 수준 캐시가 테스트 사이에 새지 않도록 비운다. 운영 코드는 호출하지 않는다. */
export function resetWebhookCacheForTests(): void {
  cache.clear();
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 총 93개 통과 (83 + 이번 10)

- [ ] **Step 5: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 6: Commit**

```bash
git add src/services/webhookService.ts src/services/webhookService.test.ts
git commit -m "feat: obtain and cache per-channel webhooks in memory"
```

---

## Task 3: 게시 경로를 Webhook으로 교체하고 첨부 전달

**Files:**
- Modify: `src/events/messageCreate.ts`

**Interfaces:**
- Consumes:
  - `sanitizeWebhookUsername(preferred: string, fallback: string): string` — `src/services/webhookIdentity.ts`
  - `getWebhook(channel: WebhookHost, botUserId: string): Promise<WebhookLike | undefined>`, `invalidateWebhook(channelId: string): void`, `type WebhookHost` — `src/services/webhookService.ts`
  - `splitForDiscord(text: string, suffix: string): string[]` — `src/services/messageChunks.ts` (변경 없음)
- Produces: 없음 (핸들러 최종 단계)

이 태스크는 **단위 테스트를 추가하지 않는다.** discord.js `Message` 목킹 비용이 크고 판단 로직은 Task 1·2의 서비스에 있다. Phase 2·3과 같은 방침이며 검증은 Task 4의 수동 시나리오로 한다. 기존 93개 테스트는 계속 통과해야 한다.

- [ ] **Step 1: import 확장**

`src/events/messageCreate.ts` 상단 import 블록을 다음으로 교체한다:

```typescript
import { ChannelType, type Message, type TextChannel } from 'discord.js';
import { findBySourceChannel } from '../services/configService';
import { AllProvidersFailedError, translate } from '../services/translationService';
import { enqueue } from '../services/messageQueue';
import { splitForDiscord } from '../services/messageChunks';
import { sanitizeWebhookUsername } from '../services/webhookIdentity';
import { getWebhook, invalidateWebhook, type WebhookHost } from '../services/webhookService';
```

- [ ] **Step 2: 첨부 수집 헬퍼 추가**

`sourceLink` 함수 아래에 추가한다:

```typescript
/**
 * 첨부는 URL만 덧붙인다. 내려받아 재업로드하면 파일 크기만큼 egress를 쓰는데
 * e2-micro는 월 1GB뿐이다(설계서 2.4). 대신 CDN 서명 만료로 나중에 깨질 수 있다.
 */
function attachmentLinks(message: Message): string {
  const urls = [...message.attachments.values()].map((attachment) => attachment.url);
  return urls.length > 0 ? `\n${urls.join('\n')}` : '';
}
```

- [ ] **Step 3: `postTranslation`을 Webhook 전송으로 교체**

기존 `postTranslation` 함수 전체를 다음으로 교체한다:

```typescript
/** Webhook을 못 얻었을 때의 폴백. 이름이 헤더로 못 올라가므로 본문 첫 줄에 굵게 넣는다. */
async function postAsBot(channel: TextChannel, author: string, body: string, link: string): Promise<void> {
  for (const chunk of splitForDiscord(`**${author}**\n${body}`, link)) {
    try {
      await channel.send({ content: chunk, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error('[messageCreate] failed to post translation', error);
      return;
    }
  }
}

async function postTranslation(message: Message, channel: TextChannel, body: string): Promise<void> {
  const author = sanitizeWebhookUsername(
    message.member?.displayName ?? '',
    message.author.username
  );
  const link = sourceLink(message);
  const botUserId = message.client.user?.id;

  const webhook = botUserId
    ? await getWebhook(channel as unknown as WebhookHost, botUserId)
    : undefined;

  if (!webhook) {
    // 미러가 조용히 멈추는 것보다 이름이 덜 정확하더라도 계속 도는 편이 낫다 (설계서 2.7)
    console.error(`[messageCreate] posting as bot; no webhook for channel ${channel.id}`);
    await postAsBot(channel, author, body, link);
    return;
  }

  const avatarURL = message.author.displayAvatarURL();

  for (const chunk of splitForDiscord(body, link)) {
    try {
      await webhook.send({
        content: chunk,
        username: author,
        avatarURL,
        // 출력 채널은 미러이므로 멘션이 다시 울리면 안 된다 (Phase 3에서 확립)
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('[messageCreate] webhook send failed', error);
      // 관리자가 Webhook을 지운 경우가 대표적이다. 캐시만 비우면 다음 메시지가 재생성한다.
      invalidateWebhook(channel.id);
      return;
    }
  }
}
```

`channel as unknown as WebhookHost` 캐스팅이 필요한 이유는 discord.js `TextChannel.fetchWebhooks()`가 `Collection<string, Webhook>`을 돌려주는데, 그 `Webhook` 타입이 우리 `WebhookLike`보다 훨씬 넓기 때문이다. 런타임 형태는 호환되며(`id`, `owner`, `send`가 모두 있다) 좁은 인터페이스로 받는 것이 테스트를 가능하게 하는 핵심이다.

- [ ] **Step 4: `translateAndPost`에서 본문 없는 경우 처리**

`translateAndPost` 함수 전체를 다음으로 교체한다:

```typescript
async function translateAndPost(
  message: Message,
  targetChannelId: string,
  targetLanguage: string
): Promise<void> {
  const channel = resolveOutputChannel(message, targetChannelId);
  if (!channel) {
    notifyChannelUnavailable(targetChannelId);
    return;
  }

  const text = message.content.trim();
  const links = attachmentLinks(message);

  // 본문이 없으면 번역할 것이 없다. 첨부만 전달하며 번역 API도 부르지 않는다 (설계서 2.5)
  if (text.length === 0) {
    await postTranslation(message, channel, links.trimStart());
    return;
  }

  let translated: string;
  try {
    const result = await translate(message.content, targetLanguage);
    // 감지 언어가 타겟과 같으면 번역문 대신 원문을 쓴다 (사양서 4.1)
    translated = result.detectedSourceLanguage === targetLanguage ? message.content : result.text;
  } catch (error) {
    if (error instanceof AllProvidersFailedError) {
      console.error(`[messageCreate] ${error.message}`);
      await notifyFailure(channel);
      return;
    }
    console.error('[messageCreate] unexpected translation error', error);
    return;
  }

  await postTranslation(message, channel, translated + links);
}
```

- [ ] **Step 5: `handleMessage`의 건너뛰기 조건 수정**

`handleMessage` 안의 본문 검사 두 줄을 다음으로 교체한다:

```typescript
    // 본문도 첨부도 없으면 전달할 것이 없다. 첨부만 있는 메시지는 번역 없이 전달한다 (설계서 2.5)
    if (message.content.trim().length === 0 && message.attachments.size === 0) return;
```

- [ ] **Step 6: 테스트와 타입 체크**

Run: `npm test`
Expected: PASS — 총 93개 통과 (새 테스트 없음, 기존이 깨지지 않았는지 확인)

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 7: Commit**

```bash
git add src/events/messageCreate.ts
git commit -m "feat: post translations under the original author via webhook"
```

---

## Task 4: 쓰지 않는 `webhookCache` 제거

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/configService.ts`
- Modify: `src/services/configService.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `GuildConfig`에서 `webhookCache` 제거, `WebhookCacheEntry` 타입 삭제

Phase 2에서 자리만 잡아두고 아무도 쓰지 않던 필드이며, Task 2에서 메모리 캐시로 확정했으므로 앞으로도 쓰지 않는다. 남겨두면 다음 작업자가 "왜 항상 비어 있는가"를 조사하게 되고, 언젠가 "미완성이니 채우자"고 판단할 여지가 생긴다.

디스크의 기존 `config.json`에 남아 있는 `"webhookCache": {}`는 로드 시 무시되고 다음 쓰기에서 사라진다. 마이그레이션 코드가 필요 없다.

- [ ] **Step 1: 타입에서 제거**

`src/types/index.ts`에서 `WebhookCacheEntry` 인터페이스 전체를 삭제하고, `GuildConfig`를 다음으로 교체한다:

```typescript
export interface GuildConfig {
  translations: TranslationConfig[];
}
```

- [ ] **Step 2: configService의 정규화에서 제거**

`src/services/configService.ts`의 `normalizeGuild` 함수를 다음으로 교체한다:

```typescript
function normalizeGuild(raw: unknown): GuildConfig {
  const candidate = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<GuildConfig>;
  return {
    translations: Array.isArray(candidate.translations) ? candidate.translations : [],
  };
}
```

같은 파일의 `upsertTranslation` 안에 있는 길드 기본값 생성도 교체한다:

```typescript
  const guild = (draft.guilds[guildId] ??= { translations: [] });
```

- [ ] **Step 3: 테스트에서 제거**

`src/services/configService.test.ts`에서 `webhookCache: {}`가 들어간 모든 시드 객체를 고친다. 예를 들어

```typescript
        g1: { translations: [...], webhookCache: {} },
```

는

```typescript
        g1: { translations: [...] },
```

가 된다. `webhookCache`라는 문자열이 이 파일에서 완전히 사라져야 한다.

`initialize normalizes a guild entry missing translations` 테스트는 그대로 둔다 — `{ version: 1, guilds: { g1: {} } }`를 넣고 `listTranslations('g1')`이 빈 배열인지 보는 테스트이므로 여전히 유효하다.

- [ ] **Step 4: 잔여 참조 확인**

Run: `grep -rn "webhookCache\|WebhookCacheEntry" src/`
Expected: 출력 없음

- [ ] **Step 5: 테스트와 타입 체크**

Run: `npm test`
Expected: PASS — 총 93개 통과

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/services/configService.ts src/services/configService.test.ts
git commit -m "refactor: drop the unused webhookCache field"
```

---

## Task 5: 수동 검증 (실제 디스코드 필요)

**Files:** 없음 (검증만)

**Interfaces:**
- Consumes: Task 1~4의 전체 결과물

이 태스크는 **사람이 실행한다.** 실제 봇 토큰, 번역 API 키, 디스코드 서버가 필요하므로 에이전트가 수행할 수 없다. 에이전트는 건너뛰고, 컨트롤러가 사용자에게 체크리스트를 전달한다.

- [ ] **Step 1: 봇 실행**

Run: `npm start`
Expected: `[translation] providers: deepl -> google` 다음에 `Logged in as ...`

- [ ] **Step 2: 시나리오 검증**

| # | 동작 | 기대 결과 |
|---|---|---|
| 1 | 원본 채널에 메시지 | 출력 채널에 **원 발신자 이름과 아바타**로 게시. 본문에 `**이름**` 줄이 없음 |
| 2 | 서버 별명을 바꾸고 다시 전송 | 바뀐 별명으로 게시 |
| 3 | 이미지만 첨부하고 본문 없이 전송 | 원 발신자 명의로 첨부 링크 게시 (이전에는 아무 일도 안 일어났음) |
| 4 | 본문 + 이미지 | 번역문과 첨부 링크가 함께 |
| 5 | 서버 설정 → 연동에서 봇이 만든 Webhook 삭제 후 전송 | 자동 재생성되어 정상 게시 |
| 6 | `Ctrl+C` 후 `npm start` 재실행, 전송 | 정상 게시 (메모리 캐시가 비어도 재조회) |
| 7 | 출력 채널에서 봇의 `Manage Webhooks` 권한 제거 후 전송 | **봇 명의로 폴백** 게시(`**이름**` 줄이 다시 나타남). 권한 복구 후에는 다시 원 발신자 명의 |
| 8 | 원본 채널에서 `@everyone` 포함해 전송 | 텍스트로만 보이고 알림은 안 감 (Phase 3 동작 유지) |

- [ ] **Step 3: config.json 확인**

Run: `cat src/store/config.json`
Expected: `webhookCache` 키가 없음 (설정을 한 번이라도 변경한 뒤)

---

## Phase 4 완료 조건

- `npm test` — 총 93개 테스트 통과 (Phase 3의 73개 + webhookIdentity 10 + webhookService 10)
- `npm run typecheck` — exit 0
- Task 5의 수동 시나리오 8개 전부 통과
- `grep -rn "webhookCache" src/` 결과 없음
- Phase 5(pm2 배포, 에러 핸들링 정비)는 별도 plan에서 다룬다
