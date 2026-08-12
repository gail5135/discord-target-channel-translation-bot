# Phase 3 (번역 파이프라인) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등록된 원본 채널의 메시지를 감지해 번역하고 출력 채널에 게시한다. Phase 2까지 저장만 되던 설정이 실제로 동작하게 된다.

**Architecture:** 제공자(DeepL, Google)는 각자 자기 언어코드 방언을 아는 독립 모듈이며, 감지 언어를 봇 내부 코드로 정규화해 반환한다. `translationService`가 고정 우선순위로 순차 호출하며 어떤 실패든 다음 제공자로 넘긴다. `messageQueue`는 채널별 Promise 체인으로 같은 채널의 처리 순서를 보장한다. `events/messageCreate.ts`는 필터링과 조립만 하는 얇은 층이다. `fetch`를 주입 가능하게 만들어 제공자 테스트가 네트워크에 나가지 않는다.

**Tech Stack:** TypeScript, Node.js 22+, discord.js v14.27, ts-node, Node 내장 `fetch`, Node 내장 테스트 러너(`node:test` + `node:assert/strict`)

## Global Constraints

- 설계 근거는 `docs/superpowers/specs/2026-08-12-phase3-translation-pipeline-design.md`, 제품 규칙은 `docs/discord-translation-bot-spec.md` §4.1·§4.6
- 제공자는 **DeepL(1순위), Google Translate(2순위)** 두 개. Papago는 무료 제공 종료로 제외 — spec §4.6
- API 키는 `.env`의 `DEEPL_API_KEY`, `GOOGLE_TRANSLATE_API_KEY`. 코드에 하드코딩 금지 — CLAUDE.md
- DeepL 엔드포인트는 키 접미사로 판별: `:fx`로 끝나면 `https://api-free.deepl.com/v2/translate`, 아니면 `https://api.deepl.com/v2/translate` — spec §4.6
- **언어 감지는 API 응답에 맡긴다.** 로컬 감지 라이브러리(`franc` 등)를 추가하지 않는다. 감지 언어가 타겟과 같으면 번역문 대신 **원문**을 게시 — spec §4.1
- **실패는 종류를 가리지 않고 다음 순위로 넘긴다.** 타임아웃·네트워크·429·456·5xx·인증 실패를 동일 취급. 제공자당 **10초 타임아웃** — spec §4.6
- 전부 실패 시 출력 채널에 알리되 **채널당 10분 쿨다운** — 설계서 §2.5
- 봇·Webhook 메시지(`author.bot` 또는 `webhookId`)는 무조건 제외 — spec §4.1
- 같은 원본 채널의 메시지는 **직렬 처리**로 순서 보장, 채널 간에는 병렬 — 설계서 §2.6
- 2000자 초과 시 분할 게시, 원문 링크는 **마지막 조각에만** — spec §4.4·§4.5
- 사용자에게 보이는 문구는 **영어**. 코드 주석은 한국어 — CLAUDE.md
- 무거운 의존성을 추가하지 않는다. **새 npm 패키지를 설치하지 않는다** (Node 내장 `fetch` 사용) — CLAUDE.md
- 커밋 시 `git add -A`/`git add .` 금지, 파일 경로 명시
- **`npm start`와 `npm run deploy-commands`를 실행하지 말 것.** 실제 Discord 게이트웨이에 접속해 무한 대기하므로 세션이 멈춘다. `npm test`, `npm run typecheck`은 안전하다

---

## Task 1: 제공자 공용 타입과 DeepL 클라이언트

**Files:**
- Create: `src/services/providers/types.ts`
- Create: `src/services/providers/deepl.ts`
- Test: `src/services/providers/deepl.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `interface TranslationResult { text: string; detectedSourceLanguage: string }` — `providers/types.ts`
  - `interface TranslationProvider { name: string; translate(text: string, targetLanguage: string): Promise<TranslationResult> }` — `providers/types.ts`
  - `type FetchLike = typeof fetch` — `providers/types.ts`
  - `createDeepLProvider(apiKey: string, fetchImpl?: FetchLike): TranslationProvider` — `providers/deepl.ts`
  - `deeplEndpoint(apiKey: string): string` — `providers/deepl.ts` (테스트용으로 export)
  - Task 3의 `translationService`가 `TranslationProvider`를 소비한다

팩토리 함수(`createDeepLProvider`)로 만드는 이유는 API 키와 `fetch` 구현을 주입받기 위해서다. 모듈 로드 시점에 `process.env`를 읽으면 테스트가 환경변수에 의존하게 되고, `fetch`를 바꿔 끼울 수 없어 네트워크에 나가게 된다.

- [ ] **Step 1: 공용 타입 작성**

`src/services/providers/types.ts`:

```typescript
export interface TranslationResult {
  text: string;
  /** 봇 내부 언어 코드로 정규화된 감지 결과 (예: 'en', 'ko', 'zh-CN') */
  detectedSourceLanguage: string;
}

export interface TranslationProvider {
  /** 로그에 남길 제공자 이름 */
  name: string;
  translate(text: string, targetLanguage: string): Promise<TranslationResult>;
}

/** 테스트에서 가짜 응답을 주입할 수 있도록 fetch를 타입으로 받는다 */
export type FetchLike = typeof fetch;
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/services/providers/deepl.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeepLProvider, deeplEndpoint } from './deepl';
import type { FetchLike } from './types';

/** 마지막 요청을 기록하면서 정해진 응답을 돌려주는 가짜 fetch */
function fakeFetch(
  status: number,
  body: unknown
): { impl: FetchLike; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as FetchLike;
  return { impl, calls };
}

test('deeplEndpoint picks the free host for keys ending in :fx', () => {
  assert.equal(deeplEndpoint('abc-123:fx'), 'https://api-free.deepl.com/v2/translate');
});

test('deeplEndpoint picks the paid host otherwise', () => {
  assert.equal(deeplEndpoint('abc-123'), 'https://api.deepl.com/v2/translate');
});

test('translate returns the translated text', async () => {
  const { impl } = fakeFetch(200, {
    translations: [{ detected_source_language: 'EN', text: '안녕하세요' }],
  });
  const provider = createDeepLProvider('key:fx', impl);

  const result = await provider.translate('hello', 'ko');

  assert.equal(result.text, '안녕하세요');
});

test('translate normalizes the detected language to internal codes', async () => {
  const { impl } = fakeFetch(200, {
    translations: [{ detected_source_language: 'ZH', text: 'hi' }],
  });
  const provider = createDeepLProvider('key:fx', impl);

  const result = await provider.translate('你好', 'en');

  assert.equal(result.detectedSourceLanguage, 'zh-CN');
});

test('translate maps en to EN-US in the request', async () => {
  const { impl, calls } = fakeFetch(200, {
    translations: [{ detected_source_language: 'KO', text: 'hello' }],
  });
  const provider = createDeepLProvider('key:fx', impl);

  await provider.translate('안녕', 'en');

  const body = String(calls[0].init?.body);
  assert.match(body, /"target_lang":"EN-US"/);
});

test('translate maps zh-CN to ZH in the request', async () => {
  const { impl, calls } = fakeFetch(200, {
    translations: [{ detected_source_language: 'KO', text: '你好' }],
  });
  const provider = createDeepLProvider('key:fx', impl);

  await provider.translate('안녕', 'zh-CN');

  const body = String(calls[0].init?.body);
  assert.match(body, /"target_lang":"ZH"/);
});

test('translate sends the key in the Authorization header', async () => {
  const { impl, calls } = fakeFetch(200, {
    translations: [{ detected_source_language: 'EN', text: '안녕' }],
  });
  const provider = createDeepLProvider('secret:fx', impl);

  await provider.translate('hello', 'ko');

  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'DeepL-Auth-Key secret:fx');
});

test('translate throws on a non-2xx response', async () => {
  const { impl } = fakeFetch(456, { message: 'Quota exceeded' });
  const provider = createDeepLProvider('key:fx', impl);

  await assert.rejects(() => provider.translate('hello', 'ko'), /456/);
});

test('translate throws when the response has no translations', async () => {
  const { impl } = fakeFetch(200, { translations: [] });
  const provider = createDeepLProvider('key:fx', impl);

  await assert.rejects(() => provider.translate('hello', 'ko'));
});

test('translate rejects an unsupported target language', async () => {
  const { impl } = fakeFetch(200, {
    translations: [{ detected_source_language: 'EN', text: 'x' }],
  });
  const provider = createDeepLProvider('key:fx', impl);

  await assert.rejects(() => provider.translate('hello', 'xx'), /xx/);
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './deepl'`

- [ ] **Step 4: DeepL 제공자 구현**

`src/services/providers/deepl.ts`:

```typescript
import type { FetchLike, TranslationProvider, TranslationResult } from './types';

/** 봇 내부 코드 → DeepL 타겟 코드. DeepL은 대문자를 요구하고 EN은 폐기되어 EN-US를 써야 한다. */
const TO_DEEPL: Record<string, string> = {
  ko: 'KO',
  en: 'EN-US',
  ja: 'JA',
  'zh-CN': 'ZH',
  es: 'ES',
  fr: 'FR',
  de: 'DE',
  ru: 'RU',
  it: 'IT',
  id: 'ID',
};

/** DeepL 감지 결과 → 봇 내부 코드. DeepL은 감지 결과로 EN/ZH처럼 지역 없는 코드를 준다. */
const FROM_DEEPL: Record<string, string> = {
  KO: 'ko',
  EN: 'en',
  'EN-US': 'en',
  'EN-GB': 'en',
  JA: 'ja',
  ZH: 'zh-CN',
  ES: 'es',
  FR: 'fr',
  DE: 'de',
  RU: 'ru',
  IT: 'it',
  ID: 'id',
};

const TIMEOUT_MS = 10_000;

/** 무료 키는 ':fx'로 끝나고 호스트가 다르다. 별도 설정 대신 키에서 판별해 어긋날 여지를 없앤다. */
export function deeplEndpoint(apiKey: string): string {
  return apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

interface DeepLResponse {
  translations?: { detected_source_language?: string; text?: string }[];
}

export function createDeepLProvider(
  apiKey: string,
  fetchImpl: FetchLike = fetch
): TranslationProvider {
  const endpoint = deeplEndpoint(apiKey);

  return {
    name: 'deepl',
    async translate(text: string, targetLanguage: string): Promise<TranslationResult> {
      const target = TO_DEEPL[targetLanguage];
      if (!target) {
        throw new Error(`deepl: unsupported target language "${targetLanguage}"`);
      }

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: [text], target_lang: target }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`deepl: HTTP ${response.status}`);
      }

      const data = (await response.json()) as DeepLResponse;
      const first = data.translations?.[0];
      if (!first || typeof first.text !== 'string') {
        throw new Error('deepl: response contained no translation');
      }

      const detected = first.detected_source_language ?? '';
      return {
        text: first.text,
        // 매핑에 없는 언어는 소문자로 떨어뜨린다. 타겟과 우연히 일치할 일이 없어 번역문이 그대로 쓰인다.
        detectedSourceLanguage: FROM_DEEPL[detected] ?? detected.toLowerCase(),
      };
    },
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 기존 38개 + 이번 9개 = 47개 통과

- [ ] **Step 6: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 7: Commit**

```bash
git add src/services/providers/types.ts src/services/providers/deepl.ts src/services/providers/deepl.test.ts
git commit -m "feat: add DeepL translation provider"
```

---

## Task 2: Google Translate 클라이언트

**Files:**
- Create: `src/services/providers/google.ts`
- Test: `src/services/providers/google.test.ts`

**Interfaces:**
- Consumes: `TranslationProvider`, `TranslationResult`, `FetchLike` — `src/services/providers/types.ts`
- Produces: `createGoogleProvider(apiKey: string, fetchImpl?: FetchLike): TranslationProvider` — `providers/google.ts`

Google Cloud Translation API v2를 쓴다. 요청은 `POST https://translation.googleapis.com/language/translate/v2?key=...`, 응답은 `{ data: { translations: [{ translatedText, detectedSourceLanguage }] } }` 형태다.

Google은 HTML 엔티티로 이스케이프된 텍스트를 돌려줄 수 있어(`&#39;` 등) 되돌리는 처리가 필요하다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/providers/google.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleProvider } from './google';
import type { FetchLike } from './types';

function fakeFetch(
  status: number,
  body: unknown
): { impl: FetchLike; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as FetchLike;
  return { impl, calls };
}

test('translate returns the translated text', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: '안녕하세요', detectedSourceLanguage: 'en' }] },
  });
  const provider = createGoogleProvider('key', impl);

  const result = await provider.translate('hello', 'ko');

  assert.equal(result.text, '안녕하세요');
  assert.equal(result.detectedSourceLanguage, 'en');
});

test('translate decodes HTML entities in the result', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'it&#39;s &amp; &quot;ok&quot;', detectedSourceLanguage: 'ko' }] },
  });
  const provider = createGoogleProvider('key', impl);

  const result = await provider.translate('그건 괜찮아', 'en');

  assert.equal(result.text, 'it\'s & "ok"');
});

test('translate sends the api key as a query parameter', async () => {
  const { impl, calls } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'hi', detectedSourceLanguage: 'ko' }] },
  });
  const provider = createGoogleProvider('secret', impl);

  await provider.translate('안녕', 'en');

  assert.match(calls[0].url, /[?&]key=secret/);
});

test('translate sends the target language in the body', async () => {
  const { impl, calls } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'hi', detectedSourceLanguage: 'ko' }] },
  });
  const provider = createGoogleProvider('key', impl);

  await provider.translate('안녕', 'zh-CN');

  const body = String(calls[0].init?.body);
  assert.match(body, /"target":"zh-CN"/);
});

test('translate throws on a non-2xx response', async () => {
  const { impl } = fakeFetch(403, { error: { message: 'API key not valid' } });
  const provider = createGoogleProvider('key', impl);

  await assert.rejects(() => provider.translate('hello', 'ko'), /403/);
});

test('translate throws when the response has no translations', async () => {
  const { impl } = fakeFetch(200, { data: { translations: [] } });
  const provider = createGoogleProvider('key', impl);

  await assert.rejects(() => provider.translate('hello', 'ko'));
});

test('translate rejects an unsupported target language', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'x', detectedSourceLanguage: 'en' }] },
  });
  const provider = createGoogleProvider('key', impl);

  await assert.rejects(() => provider.translate('hello', 'xx'), /xx/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './google'`

- [ ] **Step 3: Google 제공자 구현**

`src/services/providers/google.ts`:

```typescript
import type { FetchLike, TranslationProvider, TranslationResult } from './types';

/**
 * 봇 내부 코드 → Google 코드. 대부분 동일하지만, 지원 목록을 명시해두면
 * 오타나 미지원 언어가 API 호출 전에 걸린다.
 */
const TO_GOOGLE: Record<string, string> = {
  ko: 'ko',
  en: 'en',
  ja: 'ja',
  'zh-CN': 'zh-CN',
  es: 'es',
  fr: 'fr',
  de: 'de',
  ru: 'ru',
  it: 'it',
  id: 'id',
};

/** Google 감지 결과 → 봇 내부 코드. 중국어만 표기가 갈린다. */
const FROM_GOOGLE: Record<string, string> = {
  zh: 'zh-CN',
  'zh-CN': 'zh-CN',
  'zh-Hans': 'zh-CN',
};

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const TIMEOUT_MS = 10_000;

/** Google은 번역문을 HTML 이스케이프해서 돌려준다. 디스코드에 그대로 올리면 &#39; 같은 게 보인다. */
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

function decodeHtmlEntities(input: string): string {
  // &amp;를 마지막에 처리하면 '&amp;lt;'가 '<'로 잘못 풀린다. 정규식 한 번으로 동시에 치환한다.
  return input.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (match) => HTML_ENTITIES[match] ?? match);
}

interface GoogleResponse {
  data?: { translations?: { translatedText?: string; detectedSourceLanguage?: string }[] };
}

export function createGoogleProvider(
  apiKey: string,
  fetchImpl: FetchLike = fetch
): TranslationProvider {
  return {
    name: 'google',
    async translate(text: string, targetLanguage: string): Promise<TranslationResult> {
      const target = TO_GOOGLE[targetLanguage];
      if (!target) {
        throw new Error(`google: unsupported target language "${targetLanguage}"`);
      }

      const response = await fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, target, format: 'text' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`google: HTTP ${response.status}`);
      }

      const data = (await response.json()) as GoogleResponse;
      const first = data.data?.translations?.[0];
      if (!first || typeof first.translatedText !== 'string') {
        throw new Error('google: response contained no translation');
      }

      const detected = first.detectedSourceLanguage ?? '';
      return {
        text: decodeHtmlEntities(first.translatedText),
        detectedSourceLanguage: FROM_GOOGLE[detected] ?? detected,
      };
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 총 54개 통과 (38 + Task 1의 9 + 이번 7)

- [ ] **Step 5: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 6: Commit**

```bash
git add src/services/providers/google.ts src/services/providers/google.test.ts
git commit -m "feat: add Google Translate provider"
```

---

## Task 3: 우선순위 failover (translationService)

**Files:**
- Create: `src/services/translationService.ts`
- Test: `src/services/translationService.test.ts`

**Interfaces:**
- Consumes: `TranslationProvider`, `TranslationResult` — `src/services/providers/types.ts`. `createDeepLProvider` — `providers/deepl.ts`. `createGoogleProvider` — `providers/google.ts`
- Produces:
  - `class AllProvidersFailedError extends Error` — 필드 `attempts: { provider: string; message: string }[]`
  - `createTranslator(providers: readonly TranslationProvider[]): (text: string, targetLanguage: string) => Promise<TranslationResult>`
  - `initializeTranslator(): void` — `.env`에서 키를 읽어 기본 제공자 목록을 구성
  - `translate(text: string, targetLanguage: string): Promise<TranslationResult>` — 기본 제공자 목록 사용
  - Task 5의 `messageCreate`가 `translate`와 `AllProvidersFailedError`를 쓴다

`createTranslator`(순수 함수, 제공자 주입)와 `initializeTranslator`/`translate`(환경변수 기반 기본 구성)를 분리한다. 전자는 테스트 대상이고 후자는 배선이다. `configService`가 `initialize()`를 명시 호출로 둔 것과 같은 이유다 — 모듈 로드 시점에 `process.env`를 읽으면 테스트와 `deploy-commands` 실행이 환경변수에 묶인다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/translationService.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AllProvidersFailedError, createTranslator } from './translationService';
import type { TranslationProvider } from './providers/types';

function ok(name: string, text: string, detected = 'en'): TranslationProvider {
  return {
    name,
    translate: async () => ({ text, detectedSourceLanguage: detected }),
  };
}

function failing(name: string, message: string): TranslationProvider {
  return {
    name,
    translate: async () => {
      throw new Error(message);
    },
  };
}

test('translate uses the first provider when it succeeds', async () => {
  const calls: string[] = [];
  const first: TranslationProvider = {
    name: 'first',
    translate: async () => {
      calls.push('first');
      return { text: 'A', detectedSourceLanguage: 'en' };
    },
  };
  const second: TranslationProvider = {
    name: 'second',
    translate: async () => {
      calls.push('second');
      return { text: 'B', detectedSourceLanguage: 'en' };
    },
  };
  const translate = createTranslator([first, second]);

  const result = await translate('hello', 'ko');

  assert.equal(result.text, 'A');
  assert.deepEqual(calls, ['first']);
});

test('translate falls back to the next provider when the first fails', async () => {
  const translate = createTranslator([failing('first', 'boom'), ok('second', 'B')]);

  const result = await translate('hello', 'ko');

  assert.equal(result.text, 'B');
});

test('translate tries providers in the given order', async () => {
  const calls: string[] = [];
  const track = (name: string): TranslationProvider => ({
    name,
    translate: async () => {
      calls.push(name);
      throw new Error('nope');
    },
  });
  const translate = createTranslator([track('a'), track('b'), track('c')]);

  await assert.rejects(() => translate('hello', 'ko'));

  assert.deepEqual(calls, ['a', 'b', 'c']);
});

test('translate throws AllProvidersFailedError when every provider fails', async () => {
  const translate = createTranslator([failing('a', 'one down'), failing('b', 'two down')]);

  await assert.rejects(
    () => translate('hello', 'ko'),
    (error: unknown) => {
      assert.ok(error instanceof AllProvidersFailedError);
      assert.deepEqual(
        error.attempts.map((attempt) => attempt.provider),
        ['a', 'b']
      );
      assert.match(error.attempts[0].message, /one down/);
      return true;
    }
  );
});

test('translate throws AllProvidersFailedError when there are no providers', async () => {
  const translate = createTranslator([]);

  await assert.rejects(() => translate('hello', 'ko'), AllProvidersFailedError);
});

test('the error message names every provider that was tried', async () => {
  const translate = createTranslator([failing('a', 'one down'), failing('b', 'two down')]);

  await assert.rejects(
    () => translate('hello', 'ko'),
    (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, /a/);
      assert.match(message, /b/);
      return true;
    }
  );
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './translationService'`

- [ ] **Step 3: translationService 구현**

`src/services/translationService.ts`:

```typescript
import { createDeepLProvider } from './providers/deepl';
import { createGoogleProvider } from './providers/google';
import type { TranslationProvider, TranslationResult } from './providers/types';

export interface ProviderAttempt {
  provider: string;
  message: string;
}

export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: readonly ProviderAttempt[]) {
    const detail = attempts.map((a) => `${a.provider}: ${a.message}`).join('; ');
    super(`all translation providers failed (${detail || 'no providers configured'})`);
    this.name = 'AllProvidersFailedError';
  }
}

export type Translate = (text: string, targetLanguage: string) => Promise<TranslationResult>;

/**
 * 실패 종류를 분류하지 않고 무조건 다음 제공자로 넘긴다.
 * "이 오류는 다음도 실패한다"는 판단이 틀렸을 때 잃는 것(번역 누락)이
 * 맞았을 때 아끼는 것(호출 1회)보다 크기 때문이다.
 */
export function createTranslator(providers: readonly TranslationProvider[]): Translate {
  return async (text: string, targetLanguage: string): Promise<TranslationResult> => {
    const attempts: ProviderAttempt[] = [];

    for (const provider of providers) {
      try {
        return await provider.translate(text, targetLanguage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({ provider: provider.name, message });
        console.error(`[translation] ${provider.name} failed: ${message}`);
      }
    }

    throw new AllProvidersFailedError(attempts);
  };
}

let defaultTranslate: Translate | undefined;

/** 구동 시 1회 호출한다. 모듈 로드 시점에 env를 읽으면 테스트와 deploy-commands가 env에 묶인다. */
export function initializeTranslator(): void {
  const deeplKey = process.env.DEEPL_API_KEY?.trim();
  const googleKey = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();

  const providers: TranslationProvider[] = [];
  if (deeplKey) providers.push(createDeepLProvider(deeplKey));
  if (googleKey) providers.push(createGoogleProvider(googleKey));

  if (providers.length === 0) {
    throw new Error(
      'No translation provider configured. Set DEEPL_API_KEY and/or GOOGLE_TRANSLATE_API_KEY in .env'
    );
  }
  console.log(`[translation] providers: ${providers.map((p) => p.name).join(' -> ')}`);

  defaultTranslate = createTranslator(providers);
}

export function translate(text: string, targetLanguage: string): Promise<TranslationResult> {
  if (!defaultTranslate) {
    throw new Error('initializeTranslator() must be called before translate()');
  }
  return defaultTranslate(text, targetLanguage);
}
```

키가 하나만 있어도 그 하나로 동작한다. 둘 다 없으면 기동을 중단시킨다 — 번역할 수 없는 상태로 봇이 떠 있으면 모든 메시지가 실패 알림을 유발할 뿐이다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 총 60개 통과 (54 + 이번 6)

- [ ] **Step 5: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 6: Commit**

```bash
git add src/services/translationService.ts src/services/translationService.test.ts
git commit -m "feat: add translation failover across providers"
```

---

## Task 4: 채널별 직렬 큐

**Files:**
- Create: `src/services/messageQueue.ts`
- Test: `src/services/messageQueue.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `enqueue(key: string, task: () => Promise<void>): void` — `src/services/messageQueue.ts`
- Task 5의 `messageCreate`가 채널 ID를 key로 써서 호출한다

같은 key의 작업은 직렬로, 다른 key끼리는 병렬로 실행한다. 한 작업이 던진 예외가 뒤 작업을 막으면 안 된다 — 메시지 하나의 번역 실패가 그 채널을 영구히 마비시키게 된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/messageQueue.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueue } from './messageQueue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 큐에 넣은 작업들이 끝날 때까지 이벤트 루프를 여러 번 넘긴다 */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

test('tasks on the same key run in order', async () => {
  const order: number[] = [];
  const first = deferred();

  enqueue('channel-1', async () => {
    await first.promise;
    order.push(1);
  });
  enqueue('channel-1', async () => {
    order.push(2);
  });

  await drain();
  assert.deepEqual(order, [], 'second task must not run before the first finishes');

  first.resolve();
  await drain();
  assert.deepEqual(order, [1, 2]);
});

test('tasks on different keys are not blocked by each other', async () => {
  const order: string[] = [];
  const blocked = deferred();

  enqueue('channel-1', async () => {
    await blocked.promise;
    order.push('slow');
  });
  enqueue('channel-2', async () => {
    order.push('fast');
  });

  await drain();
  assert.deepEqual(order, ['fast'], 'channel-2 must not wait for channel-1');

  blocked.resolve();
  await drain();
  assert.deepEqual(order, ['fast', 'slow']);
});

test('a task that throws does not block later tasks on the same key', async () => {
  const order: string[] = [];

  enqueue('channel-1', async () => {
    order.push('boom');
    throw new Error('task failed');
  });
  enqueue('channel-1', async () => {
    order.push('after');
  });

  await drain();
  assert.deepEqual(order, ['boom', 'after']);
});

test('a rejected task does not produce an unhandled rejection', async () => {
  let unhandled = false;
  const onUnhandled = (): void => {
    unhandled = true;
  };
  process.on('unhandledRejection', onUnhandled);

  enqueue('channel-x', async () => {
    throw new Error('nope');
  });
  await drain();

  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, false);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './messageQueue'`

- [ ] **Step 3: 큐 구현**

`src/services/messageQueue.ts`:

```typescript
/**
 * key별 직렬 실행 큐. 같은 key(=채널)의 작업은 순서대로 하나씩,
 * 다른 key끼리는 병렬로 돈다.
 *
 * 병렬로 처리하면 긴 메시지(번역 느림)와 짧은 메시지(빠름)가 연달아 왔을 때
 * 번역문이 뒤바뀐 순서로 게시되어 대화를 읽을 수 없게 된다.
 */
const chains = new Map<string, Promise<void>>();

export function enqueue(key: string, task: () => Promise<void>): void {
  const previous = chains.get(key) ?? Promise.resolve();

  // 각 작업을 개별적으로 감싸 한 작업의 실패가 체인을 끊지 않게 한다.
  const next = previous.then(async () => {
    try {
      await task();
    } catch (error) {
      console.error('[queue] task failed', error);
    }
  });

  chains.set(key, next);

  // 체인이 비면 Map에서 지워 채널이 많은 서버에서 메모리가 늘어나지 않게 한다.
  void next.then(() => {
    if (chains.get(key) === next) {
      chains.delete(key);
    }
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 총 64개 통과 (60 + 이번 4)

- [ ] **Step 5: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 6: Commit**

```bash
git add src/services/messageQueue.ts src/services/messageQueue.test.ts
git commit -m "feat: add per-channel serial task queue"
```

---

## Task 5: 디스코드 메시지 분할 유틸

**Files:**
- Create: `src/services/messageChunks.ts`
- Test: `src/services/messageChunks.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `splitForDiscord(text: string, suffix: string): string[]` — `src/services/messageChunks.ts`
- Task 6의 `messageCreate`가 번역문과 원문 링크를 넘겨 호출한다

번역문 뒤에 원문 링크를 붙여야 하는데 디스코드 본문 상한은 2000자다. 링크는 **마지막 조각에만** 붙는다(사양서 §4.5).

핵심 함수 불변식: **반환된 모든 조각의 길이가 2000 이하**여야 한다. 특히 "본문만으로는 2000 이하지만 링크를 붙이면 초과하는" 길이 구간에서 깨지기 쉽다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/messageChunks.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitForDiscord } from './messageChunks';

const LIMIT = 2000;
const SUFFIX = '\nhttps://discord.com/channels/111111111111111111/222222222222222222/333333333333333333';

test('short text stays in one chunk with the suffix appended', () => {
  const chunks = splitForDiscord('hello', SUFFIX);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], `hello${SUFFIX}`);
});

test('every chunk stays within the discord limit', () => {
  const chunks = splitForDiscord('a'.repeat(5000), SUFFIX);

  for (const chunk of chunks) {
    assert.ok(chunk.length <= LIMIT, `chunk of ${chunk.length} exceeds ${LIMIT}`);
  }
});

test('text that fits alone but overflows with the suffix still respects the limit', () => {
  // 이 구간이 순진한 구현이 깨지는 지점이다: 본문은 2000 이하지만 접미사를 더하면 넘는다
  const text = 'a'.repeat(LIMIT - 10);

  const chunks = splitForDiscord(text, SUFFIX);

  for (const chunk of chunks) {
    assert.ok(chunk.length <= LIMIT, `chunk of ${chunk.length} exceeds ${LIMIT}`);
  }
});

test('the suffix lands on the last chunk only', () => {
  const chunks = splitForDiscord('b'.repeat(5000), SUFFIX);

  assert.ok(chunks.length > 1);
  assert.ok(chunks[chunks.length - 1].endsWith(SUFFIX));
  for (const chunk of chunks.slice(0, -1)) {
    assert.ok(!chunk.includes(SUFFIX));
  }
});

test('no characters are lost or duplicated', () => {
  const text = 'c'.repeat(4321);

  const chunks = splitForDiscord(text, SUFFIX);

  const rejoined = chunks.join('').slice(0, -SUFFIX.length);
  assert.equal(rejoined, text);
});

test('empty text yields a single chunk holding just the suffix', () => {
  const chunks = splitForDiscord('', SUFFIX);

  assert.deepEqual(chunks, [SUFFIX]);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './messageChunks'`

- [ ] **Step 3: 구현**

`src/services/messageChunks.ts`:

```typescript
/** 디스코드 메시지 본문 상한 */
export const MAX_CONTENT = 2000;

/**
 * 번역문을 2000자 이하 조각들로 나누고 접미사(원문 링크)를 마지막 조각에만 붙인다.
 *
 * 루프 조건이 `rest + suffix`가 상한을 넘는지를 보는 것이 핵심이다.
 * 본문만 기준으로 판단하면, 본문은 상한 이하인데 접미사를 더해 넘기는 구간에서
 * 마지막 조각이 상한을 초과한다.
 */
export function splitForDiscord(text: string, suffix: string): string[] {
  const chunks: string[] = [];
  let rest = text;

  while (rest.length + suffix.length > MAX_CONTENT) {
    chunks.push(rest.slice(0, MAX_CONTENT));
    rest = rest.slice(MAX_CONTENT);
  }

  chunks.push(rest + suffix);
  return chunks;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 총 70개 통과 (64 + 이번 6)

- [ ] **Step 5: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 6: Commit**

```bash
git add src/services/messageChunks.ts src/services/messageChunks.test.ts
git commit -m "feat: add discord message chunking with suffix"
```

---

## Task 6: 메시지 핸들러와 배선

**Files:**
- Create: `src/events/messageCreate.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes:
  - `findBySourceChannel(guildId, sourceChannelId): Readonly<TranslationConfig> | undefined` — `src/services/configService.ts`
  - `translate(text, targetLanguage): Promise<TranslationResult>`, `initializeTranslator()`, `AllProvidersFailedError` — `src/services/translationService.ts`
  - `enqueue(key, task)` — `src/services/messageQueue.ts`
  - `splitForDiscord(text, suffix): string[]` — `src/services/messageChunks.ts`
- Produces: `handleMessage(message: Message): void` — `src/events/messageCreate.ts`

이 태스크는 **단위 테스트를 추가하지 않는다.** discord.js `Message` 목킹 비용이 크고 실익이 낮으며, 판단 로직은 Task 1~5의 모듈에 있다. 여기 남는 것은 필터링과 조립이다. 검증은 Task 7의 수동 시나리오로 한다. 기존 70개 테스트는 계속 통과해야 한다.

- [ ] **Step 1: 메시지 핸들러 작성**

`src/events/messageCreate.ts`:

```typescript
import { ChannelType, type Message } from 'discord.js';
import { findBySourceChannel } from '../services/configService';
import { AllProvidersFailedError, translate } from '../services/translationService';
import { enqueue } from '../services/messageQueue';
import { splitForDiscord } from '../services/messageChunks';

/** 장애 중 출력 채널이 실패 알림으로 도배되지 않도록 채널당 재알림 간격을 둔다 */
const FAILURE_NOTICE_COOLDOWN_MS = 10 * 60 * 1000;
const lastFailureNotice = new Map<string, number>();

function sourceLink(message: Message): string {
  return `\nhttps://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

async function notifyFailure(message: Message, targetChannelId: string): Promise<void> {
  const now = Date.now();
  const previous = lastFailureNotice.get(targetChannelId) ?? 0;
  if (now - previous < FAILURE_NOTICE_COOLDOWN_MS) return;
  lastFailureNotice.set(targetChannelId, now);

  const channel = message.guild?.channels.cache.get(targetChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  await channel
    .send(
      'Translation is currently failing for every configured provider. ' +
        'Messages are not being translated until this is resolved. ' +
        'Check the server logs and the API quota.'
    )
    .catch((error: unknown) => console.error('[messageCreate] failed to post failure notice', error));
}

async function process(message: Message, targetChannelId: string, targetLanguage: string): Promise<void> {
  let body: string;
  try {
    const result = await translate(message.content, targetLanguage);
    // 감지 언어가 타겟과 같으면 번역문 대신 원문을 쓴다 (사양서 4.1)
    body = result.detectedSourceLanguage === targetLanguage ? message.content : result.text;
  } catch (error) {
    if (error instanceof AllProvidersFailedError) {
      console.error(`[messageCreate] ${error.message}`);
      await notifyFailure(message, targetChannelId);
      return;
    }
    console.error('[messageCreate] unexpected translation error', error);
    return;
  }

  const channel = message.guild?.channels.cache.get(targetChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error(`[messageCreate] output channel ${targetChannelId} is unavailable`);
    return;
  }

  const author = message.member?.displayName ?? message.author.username;
  const chunks = splitForDiscord(`**${author}**\n${body}`, sourceLink(message));

  for (const chunk of chunks) {
    try {
      await channel.send(chunk);
    } catch (error) {
      console.error('[messageCreate] failed to post translation', error);
      return;
    }
  }
}

export function handleMessage(message: Message): void {
  // 봇·Webhook 메시지는 무조건 제외한다 (번역 루프 방지, 사양서 4.1)
  if (message.author.bot || message.webhookId) return;
  if (!message.guildId) return;

  const setting = findBySourceChannel(message.guildId, message.channelId);
  if (!setting) return;

  // 본문이 없으면 번역할 것이 없다. 첨부만 있는 메시지는 Phase 4에서 다룬다.
  if (message.content.trim().length === 0) return;

  enqueue(message.channelId, () =>
    process(message, setting.targetChannelId, setting.targetLanguage)
  );
}
```

- [ ] **Step 2: index.ts 배선**

`src/index.ts` 전체를 다음으로 교체한다:

```typescript
import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initialize as initializeConfig } from './services/configService';
import { initializeTranslator } from './services/translationService';
import { handleInteraction } from './events/interactionCreate';
import { handleMessage } from './events/messageCreate';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN must be set in .env');
}

// 설정을 읽지 못한 채 봇이 떠 있는 것보다 기동 실패가 낫다
initializeConfig();
// 번역할 수 없는 상태로 떠 있으면 모든 메시지가 실패 알림만 유발한다
initializeTranslator();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Developer Portal에서 MESSAGE CONTENT INTENT를 켜야 실제로 내용이 들어온다
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.MessageCreate, handleMessage);

client.login(token);
```

- [ ] **Step 3: 테스트와 타입 체크**

Run: `npm test`
Expected: PASS — 총 70개 통과 (새 테스트 없음, 기존이 깨지지 않았는지 확인)

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 4: Commit**

```bash
git add src/events/messageCreate.ts src/index.ts
git commit -m "feat: translate messages from monitored channels"
```

---

## Task 7: 수동 검증 (실제 디스코드와 API 키 필요)

**Files:** 없음 (검증만)

**Interfaces:**
- Consumes: Task 1~6의 전체 결과물

이 태스크는 **사람이 실행한다.** 실제 봇 토큰, 번역 API 키, 디스코드 서버가 필요하므로 에이전트가 수행할 수 없다. 에이전트는 건너뛰고, 컨트롤러가 사용자에게 체크리스트를 전달한다.

- [ ] **Step 1: 사전 조건**

- Developer Portal → Bot → **MESSAGE CONTENT INTENT 활성화** (없으면 `message.content`가 항상 빈 문자열이라 모든 메시지가 4번 필터에서 걸러진다)
- `.env`에 `DEEPL_API_KEY` 또는 `GOOGLE_TRANSLATE_API_KEY` 중 최소 하나
- `/setting register`로 원본·출력 채널과 타겟 언어가 등록되어 있을 것

- [ ] **Step 2: 봇 실행**

Run: `npm start`
Expected: `[translation] providers: deepl -> google` (또는 설정된 키에 따라 하나만) 다음에 `Logged in as ...`

- [ ] **Step 3: 시나리오 검증**

| # | 동작 | 기대 결과 |
|---|---|---|
| 1 | 원본 채널에 타겟과 **다른** 언어로 메시지 | 출력 채널에 `**작성자**` + 번역문 + 원문 링크 |
| 2 | 원본 채널에 타겟과 **같은** 언어로 메시지 | 출력 채널에 원문 그대로 (번역되지 않은 형태) |
| 3 | 봇이 출력 채널에 올린 메시지 | 다시 번역되지 않음 (루프 없음) |
| 4 | 짧은 메시지 5개를 빠르게 연속 전송 | 출력 채널에서 **보낸 순서 그대로** 표시 |
| 5 | 2000자를 넘는 긴 메시지 | 여러 조각으로 분할, 원문 링크는 마지막 조각에만 |
| 6 | `.env`의 두 키를 모두 잘못된 값으로 바꾸고 재시작 후 메시지 전송 | 출력 채널에 실패 알림 1회. 이어서 메시지를 더 보내도 10분간 재알림 없음 |
| 7 | 첨부파일만 있고 본문이 없는 메시지 | 아무 일도 일어나지 않음 (Phase 3 범위 밖) |
| 8 | 등록되지 않은 채널에 메시지 | 아무 일도 일어나지 않음 |

6번 검증 후 `.env`의 키를 원래대로 되돌리고 재시작할 것.

---

## Phase 3 완료 조건

- `npm test` — 총 70개 테스트 통과 (Phase 2의 38개 + deepl 9 + google 7 + translationService 6 + messageQueue 4 + messageChunks 6)
- `npm run typecheck` — exit 0
- Task 7의 수동 시나리오 8개 전부 통과
- Phase 4(Webhook 게시, 첨부파일 전달)는 별도 plan에서 다룬다
