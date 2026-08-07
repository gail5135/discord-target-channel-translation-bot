# Phase 2 (`/setting` 커맨드 처리 로직) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/setting register|list|remove`가 실제로 동작하게 만든다. 관리자가 설정을 등록·조회·삭제할 수 있고, 봇 재시작 후에도 유지된다.

**Architecture:** 검증할 가치가 있는 로직은 `services/`에 두고 discord.js 의존은 `commands/`에 가둔다. `configService`가 메모리 캐시를 소유하며 구동 시 1회 적재하고 변경 시에만 파일에 기록한다(캐시 일관성을 위해 사본 수정 → 저장 → 캐시 반영 순서). `channelPermissions`는 봇의 채널 권한 부족분을 계산한다. 두 서비스 모두 discord.js `Interaction`에 의존하지 않아 단위 테스트가 가능하다. `commands/setting.ts`의 핸들러는 옵션을 읽어 서비스에 넘기고 응답 문자열을 만드는 얇은 층으로 유지한다.

**Tech Stack:** TypeScript, Node.js 22+, discord.js v14.27, ts-node, Node 내장 테스트 러너(`node:test` + `node:assert/strict`)

## Global Constraints

- 설계 근거는 `docs/superpowers/specs/2026-08-07-phase2-setting-commands-design.md`, 제품 규칙 요약은 `docs/discord-translation-bot-spec.md` §4.2.2에 있다
- 원본 채널당 설정은 **1개**. 이미 등록된 원본 채널을 다시 등록하면 **덮어쓰고 변경 내용을 안내**한다 — spec §4.2.2
- 원본 채널과 출력 채널이 **같으면 거부**한다 — spec §4.2.2
- 등록 시 봇 권한을 검사해 부족하면 **무엇이 부족한지 채널별로 명시**해 거부한다. 원본: `ViewChannel`. 출력: `ViewChannel`, `SendMessages`, `ManageWebhooks` — spec §4.2.2
- 모든 `/setting` 응답은 **ephemeral**(`flags: MessageFlags.Ephemeral`)이며 임베드 없이 평문이다 — spec §4.2.2
- 설정 ID는 `cfg_` + base36 6자 랜덤, 길드 내 충돌 시 재생성 — dev-plan §4
- config.json 경로는 `path.join(__dirname, 'config.json')` 상수를 유일한 출처로 삼는다. `process.cwd()` 사용 금지 — dev-plan §4
- 캐시/디스크 일관성: **사본 수정 → 저장 성공 → 캐시 반영** 순서. 저장 실패 시 캐시를 손대지 않고 예외를 전파한다 — dev-plan §4
- 빌드 단계 없이 `ts-node`로 직접 실행한다. 무거운 의존성을 추가하지 않는다(e2-micro RAM 약 1GB) — CLAUDE.md
- 커밋 시 `git add -A`/`git add .` 대신 변경한 파일 경로를 하나씩 명시해서 스테이징한다
- **`npm start`와 `npm run deploy-commands`를 실행하지 말 것.** 실제 Discord 게이트웨이에 접속해 무한 대기하므로 세션이 멈춘다. `npm test`, `npm run typecheck`은 안전하다

---

## Task 1: config 경로 상수와 configService 기본 골격

**Files:**
- Create: `src/store/configPath.ts`
- Create: `src/services/configService.ts`
- Test: `src/services/configService.test.ts`

**Interfaces:**
- Consumes: `loadStore(filePath: string): StoreData`, `saveStore(filePath: string, data: StoreData, options?: { skipBackup?: boolean }): void` — `src/store/jsonStore.ts`. `StoreData`, `GuildConfig`, `TranslationConfig` — `src/types/index.ts`
- Produces:
  - `CONFIG_PATH: string` — `src/store/configPath.ts`
  - `initialize(filePath?: string): void` — `src/services/configService.ts`
  - `listTranslations(guildId: string): TranslationConfig[]`
  - `findBySourceChannel(guildId: string, sourceChannelId: string): TranslationConfig | undefined` — Phase 3의 메시지 라우팅이 쓸 조회 함수다. Phase 2의 커맨드 핸들러는 쓰지 않지만(교체 여부는 `upsertTranslation`의 `replaced`로 알 수 있다) 캐시 조회가 길드별로 올바른지 검증하는 테스트 대상이므로 여기서 만든다
  - Task 2가 `upsertTranslation`·`removeTranslation`을 같은 파일에 추가한다

`initialize`가 테스트용 경로를 받을 수 있게 선택 인자를 둔다. 인자를 생략하면 `CONFIG_PATH`를 쓴다. 이렇게 하면 테스트가 임시 디렉토리를 쓸 수 있고, 운영 코드는 인자 없이 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/configService.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as configService from './configService';
import type { StoreData } from '../types';

function tempConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'configservice-test-'));
  return path.join(dir, 'config.json');
}

function seed(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data));
}

test('initialize creates a default store when the file is absent', () => {
  const filePath = tempConfigPath();

  configService.initialize(filePath);

  assert.deepEqual(configService.listTranslations('any-guild'), []);
  assert.equal(fs.existsSync(filePath), true);
});

test('initialize loads existing translations into the cache', () => {
  const filePath = tempConfigPath();
  const data: StoreData = {
    version: 1,
    guilds: {
      g1: {
        translations: [
          {
            id: 'cfg_aaaaaa',
            sourceChannelId: 's1',
            targetChannelId: 't1',
            targetLanguage: 'ko',
            createdAt: '2026-08-07T00:00:00Z',
          },
        ],
        webhookCache: {},
      },
    },
  };
  seed(filePath, data);

  configService.initialize(filePath);

  const list = configService.listTranslations('g1');
  assert.equal(list.length, 1);
  assert.equal(list[0].sourceChannelId, 's1');
});

test('initialize normalizes a guild entry missing translations', () => {
  const filePath = tempConfigPath();
  seed(filePath, { version: 1, guilds: { g1: {} } });

  configService.initialize(filePath);

  assert.deepEqual(configService.listTranslations('g1'), []);
});

test('initialize normalizes guilds when it is not an object', () => {
  const filePath = tempConfigPath();
  seed(filePath, { version: 1, guilds: [] });

  configService.initialize(filePath);

  assert.deepEqual(configService.listTranslations('g1'), []);
});

test('listTranslations returns an empty array for an unknown guild', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);

  assert.deepEqual(configService.listTranslations('never-seen'), []);
});

test('findBySourceChannel locates a setting by its source channel', () => {
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
            createdAt: '2026-08-07T00:00:00Z',
          },
        ],
        webhookCache: {},
      },
    },
  });
  configService.initialize(filePath);

  assert.equal(configService.findBySourceChannel('g1', 's1')?.id, 'cfg_aaaaaa');
  assert.equal(configService.findBySourceChannel('g1', 'nope'), undefined);
  assert.equal(configService.findBySourceChannel('other-guild', 's1'), undefined);
});

test('listTranslations returns a copy that cannot mutate the cache', () => {
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
            createdAt: '2026-08-07T00:00:00Z',
          },
        ],
        webhookCache: {},
      },
    },
  });
  configService.initialize(filePath);

  configService.listTranslations('g1').pop();

  assert.equal(configService.listTranslations('g1').length, 1);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './configService'`

- [ ] **Step 3: 경로 상수 작성**

`src/store/configPath.ts`:

```typescript
import path from 'node:path';

/**
 * config.json의 정식 위치. `process.cwd()`가 아니라 `__dirname` 기준으로 잡아,
 * pm2가 어느 디렉토리에서 실행하든 같은 파일을 가리키게 한다.
 */
export const CONFIG_PATH = path.join(__dirname, 'config.json');
```

- [ ] **Step 4: configService 골격 구현**

`src/services/configService.ts`:

```typescript
import { loadStore, saveStore } from '../store/jsonStore';
import { CONFIG_PATH } from '../store/configPath';
import type { GuildConfig, StoreData, TranslationConfig } from '../types';

let cache: StoreData | undefined;
let storePath: string = CONFIG_PATH;

function normalizeGuild(raw: unknown): GuildConfig {
  const candidate = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<GuildConfig>;
  return {
    translations: Array.isArray(candidate.translations) ? candidate.translations : [],
    webhookCache:
      typeof candidate.webhookCache === 'object' && candidate.webhookCache !== null
        ? candidate.webhookCache
        : {},
  };
}

/**
 * jsonStore의 검증은 최상위 구조만 확인하므로, `translations`가 없는 길드 항목이
 * 통과할 수 있다. 그대로 두면 나중에 push 호출이 undefined에서 터진다.
 */
function normalize(data: StoreData): StoreData {
  const rawGuilds =
    typeof data.guilds === 'object' && data.guilds !== null && !Array.isArray(data.guilds)
      ? data.guilds
      : {};
  const guilds: Record<string, GuildConfig> = {};
  for (const [guildId, guildData] of Object.entries(rawGuilds)) {
    guilds[guildId] = normalizeGuild(guildData);
  }
  return { version: typeof data.version === 'number' ? data.version : 1, guilds };
}

function requireCache(): StoreData {
  if (!cache) {
    throw new Error('configService.initialize() must be called before use');
  }
  return cache;
}

export function initialize(filePath: string = CONFIG_PATH): void {
  storePath = filePath;
  cache = normalize(loadStore(filePath));
}

export function listTranslations(guildId: string): TranslationConfig[] {
  return [...(requireCache().guilds[guildId]?.translations ?? [])];
}

export function findBySourceChannel(
  guildId: string,
  sourceChannelId: string
): TranslationConfig | undefined {
  return requireCache().guilds[guildId]?.translations.find(
    (translation) => translation.sourceChannelId === sourceChannelId
  );
}
```

`storePath`와 `saveStore` import는 Task 2에서 쓰인다. Task 1 시점에는 `storePath`가 할당만 되고 읽히지 않으므로, `noUnusedLocals`가 켜져 있지 않은 현재 tsconfig에서는 typecheck를 통과한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 기존 15개 + 이번 7개 = 22개 통과

- [ ] **Step 6: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 7: Commit**

```bash
git add src/store/configPath.ts src/services/configService.ts src/services/configService.test.ts
git commit -m "feat: add config path constant and configService cache"
```

---

## Task 2: configService 쓰기 연산 (upsert / remove)

**Files:**
- Modify: `src/services/configService.ts`
- Test: `src/services/configService.test.ts`

**Interfaces:**
- Consumes: Task 1의 `initialize`, `listTranslations`, `findBySourceChannel`, 모듈 내부의 `cache`·`storePath`·`requireCache`
- Produces:
  - `upsertTranslation(guildId: string, input: TranslationInput): UpsertResult`
  - `removeTranslation(guildId: string, id: string): TranslationConfig | undefined`
  - `interface TranslationInput { sourceChannelId: string; targetChannelId: string; targetLanguage: string }`
  - `interface UpsertResult { setting: TranslationConfig; replaced?: TranslationConfig }`
  - Task 4의 `commands/setting.ts` 핸들러가 이 세 가지를 호출한다

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/configService.test.ts` 끝에 추가:

```typescript
test('upsertTranslation adds a new setting and persists it', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);

  const result = configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  assert.equal(result.replaced, undefined);
  assert.equal(result.setting.sourceChannelId, 's1');
  assert.match(result.setting.id, /^cfg_[0-9a-z]{6}$/);
  assert.equal(configService.listTranslations('g1').length, 1);

  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.equal(onDisk.guilds.g1.translations.length, 1);
});

test('upsertTranslation replaces the setting for an already registered source channel', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);
  const first = configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  const second = configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't2',
    targetLanguage: 'ja',
  });

  assert.equal(second.replaced?.id, first.setting.id);
  assert.equal(second.replaced?.targetLanguage, 'ko');
  assert.equal(second.setting.targetLanguage, 'ja');
  assert.equal(configService.listTranslations('g1').length, 1);
});

test('upsertTranslation keeps settings of different guilds separate', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);

  configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });
  configService.upsertTranslation('g2', {
    sourceChannelId: 's1',
    targetChannelId: 't9',
    targetLanguage: 'ja',
  });

  assert.equal(configService.listTranslations('g1').length, 1);
  assert.equal(configService.listTranslations('g2').length, 1);
  assert.equal(configService.findBySourceChannel('g2', 's1')?.targetChannelId, 't9');
});

test('upsertTranslation assigns unique ids within a guild', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);

  const ids = new Set<string>();
  for (let i = 0; i < 30; i += 1) {
    ids.add(
      configService.upsertTranslation('g1', {
        sourceChannelId: `s${i}`,
        targetChannelId: 't1',
        targetLanguage: 'ko',
      }).setting.id
    );
  }

  assert.equal(ids.size, 30);
});

test('removeTranslation deletes the setting and persists the change', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);
  const created = configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  const removed = configService.removeTranslation('g1', created.setting.id);

  assert.equal(removed?.id, created.setting.id);
  assert.deepEqual(configService.listTranslations('g1'), []);

  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.deepEqual(onDisk.guilds.g1.translations, []);
});

test('removeTranslation returns undefined for an unknown id', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);

  assert.equal(configService.removeTranslation('g1', 'cfg_zzzzzz'), undefined);
});

test('settings survive a reload from disk', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);
  configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  configService.initialize(filePath);

  assert.equal(configService.listTranslations('g1').length, 1);
});

test('a failed save leaves the cache untouched', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);
  configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  // 파일이 있어야 할 자리를 디렉토리로 막아 쓰기를 실패시킨다
  fs.rmSync(filePath);
  fs.mkdirSync(filePath);

  assert.throws(() =>
    configService.upsertTranslation('g1', {
      sourceChannelId: 's2',
      targetChannelId: 't2',
      targetLanguage: 'ja',
    })
  );
  assert.equal(configService.listTranslations('g1').length, 1);
  assert.equal(configService.findBySourceChannel('g1', 's2'), undefined);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `configService.upsertTranslation is not a function`

- [ ] **Step 3: 쓰기 연산 구현**

`src/services/configService.ts` 끝에 추가:

```typescript
export interface TranslationInput {
  sourceChannelId: string;
  targetChannelId: string;
  targetLanguage: string;
}

export interface UpsertResult {
  setting: TranslationConfig;
  replaced?: TranslationConfig;
}

function generateId(existing: TranslationConfig[]): string {
  const taken = new Set(existing.map((translation) => translation.id));
  for (;;) {
    const id = `cfg_${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * 캐시를 먼저 고치고 저장하면, 저장이 실패했을 때 메모리와 디스크가 어긋난 채
 * 봇이 계속 돈다. 사본에 적용하고 저장이 성공한 뒤에만 캐시를 교체한다.
 */
function commit(draft: StoreData): void {
  saveStore(storePath, draft);
  cache = draft;
}

function cloneStore(data: StoreData): StoreData {
  return JSON.parse(JSON.stringify(data)) as StoreData;
}

export function upsertTranslation(guildId: string, input: TranslationInput): UpsertResult {
  const draft = cloneStore(requireCache());
  const guild = (draft.guilds[guildId] ??= { translations: [], webhookCache: {} });

  const index = guild.translations.findIndex(
    (translation) => translation.sourceChannelId === input.sourceChannelId
  );
  const replaced = index >= 0 ? guild.translations[index] : undefined;

  const setting: TranslationConfig = {
    id: replaced?.id ?? generateId(guild.translations),
    sourceChannelId: input.sourceChannelId,
    targetChannelId: input.targetChannelId,
    targetLanguage: input.targetLanguage,
    createdAt: new Date().toISOString(),
  };

  if (index >= 0) {
    guild.translations[index] = setting;
  } else {
    guild.translations.push(setting);
  }

  commit(draft);
  return replaced ? { setting, replaced } : { setting };
}

export function removeTranslation(guildId: string, id: string): TranslationConfig | undefined {
  const draft = cloneStore(requireCache());
  const guild = draft.guilds[guildId];
  if (!guild) return undefined;

  const index = guild.translations.findIndex((translation) => translation.id === id);
  if (index < 0) return undefined;

  const [removed] = guild.translations.splice(index, 1);
  commit(draft);
  return removed;
}
```

덮어쓸 때 기존 `id`를 유지한다. 자동완성 목록이 열려 있는 상태에서 다른 관리자가 재등록하더라도, 이미 표시된 ID가 계속 유효하게 하기 위함이다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 총 30개 통과 (기존 15 + Task 1의 7 + 이번 8)

- [ ] **Step 5: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 6: Commit**

```bash
git add src/services/configService.ts src/services/configService.test.ts
git commit -m "feat: add upsert and remove to configService"
```

---

## Task 3: 봇 채널 권한 검사

**Files:**
- Create: `src/services/channelPermissions.ts`
- Test: `src/services/channelPermissions.test.ts`

**Interfaces:**
- Consumes: `PermissionFlagsBits` — `discord.js`
- Produces:
  - `SOURCE_CHANNEL_PERMISSIONS: readonly PermissionEntry[]`
  - `TARGET_CHANNEL_PERMISSIONS: readonly PermissionEntry[]`
  - `interface PermissionEntry { flag: bigint; label: string }`
  - `interface PermissionSet { has(flag: bigint): boolean }`
  - `missingPermissions(permissions: PermissionSet | null, required: readonly PermissionEntry[]): string[]`
  - Task 4의 register 핸들러가 이 함수와 두 상수를 쓴다

**채널 객체가 아니라 이미 계산된 권한 객체를 받는다.** 호출부가 `channel.permissionsFor(botMember)`를 호출해 그 결과를 넘긴다. 이렇게 하면 이 모듈이 discord.js 채널 타입에 전혀 의존하지 않아 구조적 타입 불일치 위험이 없고, 테스트도 `{ has: () => boolean }` 한 줄로 끝난다. `permissionsFor`는 봇이 채널을 볼 수 없을 때 `null`을 반환할 수 있으므로 그 경우를 "전부 부족"으로 처리한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/channelPermissions.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import {
  missingPermissions,
  SOURCE_CHANNEL_PERMISSIONS,
  TARGET_CHANNEL_PERMISSIONS,
} from './channelPermissions';

/** 보유한 권한 비트 집합만 흉내내는 최소 권한 객체 */
function granting(flags: bigint[]) {
  return { has: (flag: bigint) => flags.includes(flag) };
}

test('missingPermissions returns an empty array when everything is granted', () => {
  const permissions = granting([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageWebhooks,
  ]);

  assert.deepEqual(missingPermissions(permissions, TARGET_CHANNEL_PERMISSIONS), []);
});

test('missingPermissions lists only the labels that are missing', () => {
  const permissions = granting([PermissionFlagsBits.ViewChannel]);

  assert.deepEqual(missingPermissions(permissions, TARGET_CHANNEL_PERMISSIONS), [
    'Send Messages',
    'Manage Webhooks',
  ]);
});

test('missingPermissions treats null as everything missing', () => {
  assert.deepEqual(missingPermissions(null, SOURCE_CHANNEL_PERMISSIONS), ['View Channel']);
  assert.deepEqual(missingPermissions(null, TARGET_CHANNEL_PERMISSIONS), [
    'View Channel',
    'Send Messages',
    'Manage Webhooks',
  ]);
});

test('source channel only requires View Channel', () => {
  assert.deepEqual(
    SOURCE_CHANNEL_PERMISSIONS.map((entry) => entry.label),
    ['View Channel']
  );
});

test('target channel requires view, send, and webhook management', () => {
  assert.deepEqual(
    TARGET_CHANNEL_PERMISSIONS.map((entry) => entry.label),
    ['View Channel', 'Send Messages', 'Manage Webhooks']
  );
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './channelPermissions'`

- [ ] **Step 3: 구현**

`src/services/channelPermissions.ts`:

```typescript
import { PermissionFlagsBits } from 'discord.js';

export interface PermissionEntry {
  flag: bigint;
  label: string;
}

/** `channel.permissionsFor(member)`가 돌려주는 객체의 최소 형태 */
export interface PermissionSet {
  has(flag: bigint): boolean;
}

/** 메시지 이벤트를 받으려면 채널을 볼 수 있어야 한다 (Phase 3) */
export const SOURCE_CHANNEL_PERMISSIONS: readonly PermissionEntry[] = [
  { flag: PermissionFlagsBits.ViewChannel, label: 'View Channel' },
];

/** Webhook을 만들고 번역문을 게시하려면 셋 다 필요하다 (Phase 4) */
export const TARGET_CHANNEL_PERMISSIONS: readonly PermissionEntry[] = [
  { flag: PermissionFlagsBits.ViewChannel, label: 'View Channel' },
  { flag: PermissionFlagsBits.SendMessages, label: 'Send Messages' },
  { flag: PermissionFlagsBits.ManageWebhooks, label: 'Manage Webhooks' },
];

/**
 * 봇이 채널을 볼 수 없으면 `permissionsFor`가 null을 돌려준다.
 * 그 경우 요구 권한 전부가 부족한 것으로 본다.
 */
export function missingPermissions(
  permissions: PermissionSet | null,
  required: readonly PermissionEntry[]
): string[] {
  if (!permissions) {
    return required.map((entry) => entry.label);
  }
  return required.filter((entry) => !permissions.has(entry.flag)).map((entry) => entry.label);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 총 35개 통과

- [ ] **Step 5: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 6: Commit**

```bash
git add src/services/channelPermissions.ts src/services/channelPermissions.test.ts
git commit -m "feat: add bot channel permission check"
```

---

## Task 4: `/setting` 핸들러와 자동완성

**Files:**
- Modify: `src/commands/setting.ts`

**Interfaces:**
- Consumes:
  - `listTranslations`, `upsertTranslation`, `removeTranslation`, `UpsertResult` — `src/services/configService.ts` (`findBySourceChannel`은 Phase 3의 메시지 라우팅용이며 여기서는 쓰지 않는다 — `upsertTranslation`이 교체 여부를 `replaced`로 알려주기 때문)
  - `missingPermissions`, `SOURCE_CHANNEL_PERMISSIONS`, `TARGET_CHANNEL_PERMISSIONS` — `src/services/channelPermissions.ts`
  - `TranslationConfig` — `src/types/index.ts`
  - `data` (기존 `SlashCommandBuilder`) — 같은 파일
- Produces:
  - `execute(interaction: ChatInputCommandInteraction): Promise<void>`
  - `autocomplete(interaction: AutocompleteInteraction): Promise<void>`
  - Task 5의 `events/interactionCreate.ts`가 이 둘을 호출한다

기존 `data` 빌더는 그대로 두고 아래 내용을 파일 끝에 추가한다. 기존 커맨드 구조 테스트 5개가 계속 통과해야 한다.

이 파일의 핸들러는 단위 테스트하지 않는다 — discord.js `Interaction` 목킹 비용이 크고, 판단 로직은 Task 1~3의 서비스로 이미 추출했다. 검증은 Task 6의 수동 시나리오로 한다.

- [ ] **Step 1: import 확장**

`src/commands/setting.ts` 첫 줄을 다음으로 교체한다:

```typescript
import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  listTranslations,
  removeTranslation,
  upsertTranslation,
  type UpsertResult,
} from '../services/configService';
import {
  missingPermissions,
  SOURCE_CHANNEL_PERMISSIONS,
  TARGET_CHANNEL_PERMISSIONS,
} from '../services/channelPermissions';
import type { TranslationConfig } from '../types';
```

- [ ] **Step 2: 언어 표시명 맵과 포맷 헬퍼 추가**

`data` 빌더 정의 아래에 추가한다:

```typescript
/** 커맨드 choices와 같은 표시명. 응답에서 코드 대신 사람이 읽는 이름을 쓴다. */
const LANGUAGE_LABELS: Record<string, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  'zh-CN': '中文(简体)',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
  it: 'Italiano',
  id: 'Bahasa Indonesia',
};

function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code;
}

/** 채널이 아직 존재하면 멘션으로, 삭제됐으면 그 사실을 드러낸다. */
function channelLabel(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  channelId: string
): string {
  const channel = interaction.guild?.channels.cache.get(channelId);
  return channel ? `<#${channelId}>` : `(삭제된 채널 ${channelId})`;
}

function describe(
  interaction: ChatInputCommandInteraction,
  setting: TranslationConfig
): string {
  const source = channelLabel(interaction, setting.sourceChannelId);
  const target = channelLabel(interaction, setting.targetChannelId);
  return `${source} → ${target} (${languageLabel(setting.targetLanguage)})`;
}
```

- [ ] **Step 3: register 핸들러 추가**

```typescript
async function handleRegister(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) {
    await interaction.reply({
      content: '이 명령어는 서버 안에서만 사용할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sourceOption = interaction.options.getChannel('source-channel', true);
  const targetOption = interaction.options.getChannel('target-channel', true);
  const targetLanguage = interaction.options.getString('target-language', true);

  if (sourceOption.id === targetOption.id) {
    await interaction.reply({
      content: '원본 채널과 출력 채널이 같습니다. 서로 다른 채널을 지정해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = interaction.guild.members.me;
  if (!botMember) {
    await interaction.reply({
      content: '봇 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // getChannel의 반환 타입은 permissionsFor가 없는 형태를 포함하므로,
  // 길드 캐시에서 실제 채널 객체를 다시 얻는다.
  const sourceChannel = interaction.guild.channels.cache.get(sourceOption.id);
  const targetChannel = interaction.guild.channels.cache.get(targetOption.id);
  if (!sourceChannel || !targetChannel) {
    await interaction.reply({
      content: '채널 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const problems: string[] = [];
  const sourceMissing = missingPermissions(
    sourceChannel.permissionsFor(botMember),
    SOURCE_CHANNEL_PERMISSIONS
  );
  if (sourceMissing.length > 0) {
    problems.push(`<#${sourceChannel.id}>: ${sourceMissing.join(', ')}`);
  }
  const targetMissing = missingPermissions(
    targetChannel.permissionsFor(botMember),
    TARGET_CHANNEL_PERMISSIONS
  );
  if (targetMissing.length > 0) {
    problems.push(`<#${targetChannel.id}>: ${targetMissing.join(', ')}`);
  }

  if (problems.length > 0) {
    await interaction.reply({
      content: [
        '봇에게 필요한 권한이 없어 등록하지 못했습니다.',
        ...problems.map((problem) => `• ${problem}`),
        '',
        '채널 권한을 부여한 뒤 다시 시도해주세요.',
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let result: UpsertResult;
  try {
    result = upsertTranslation(guildId, {
      sourceChannelId: sourceChannel.id,
      targetChannelId: targetChannel.id,
      targetLanguage,
    });
  } catch (error) {
    console.error('[setting] failed to save translation config', error);
    await interaction.reply({
      content: '설정을 저장하지 못했습니다. 서버 로그를 확인해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const content = result.replaced
    ? [
        `<#${sourceChannel.id}>의 설정을 변경했습니다.`,
        `  이전: ${channelLabel(interaction, result.replaced.targetChannelId)} (${languageLabel(result.replaced.targetLanguage)})`,
        `  변경: ${channelLabel(interaction, result.setting.targetChannelId)} (${languageLabel(result.setting.targetLanguage)})`,
      ].join('\n')
    : `설정을 등록했습니다.\n  ${describe(interaction, result.setting)}`;

  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
```

- [ ] **Step 4: list · remove 핸들러 추가**

```typescript
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: '이 명령어는 서버 안에서만 사용할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settings = listTranslations(guildId);
  if (settings.length === 0) {
    await interaction.reply({
      content: '등록된 설정이 없습니다. `/setting register`로 등록해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = settings.map((setting) => `• ${describe(interaction, setting)}`);
  await interaction.reply({
    content: [`등록된 설정 ${settings.length}개:`, ...lines].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: '이 명령어는 서버 안에서만 사용할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const id = interaction.options.getString('id', true);

  let removed: TranslationConfig | undefined;
  try {
    removed = removeTranslation(guildId, id);
  } catch (error) {
    console.error('[setting] failed to save translation config', error);
    await interaction.reply({
      content: '설정을 저장하지 못했습니다. 서버 로그를 확인해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!removed) {
    await interaction.reply({
      content: '해당 설정을 찾지 못했습니다. 이미 삭제되었을 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `설정을 삭제했습니다.\n  ${describe(interaction, removed)}`,
    flags: MessageFlags.Ephemeral,
  });
}
```

- [ ] **Step 5: execute 디스패처와 autocomplete 추가**

```typescript
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case 'register':
      await handleRegister(interaction);
      return;
    case 'list':
      await handleList(interaction);
      return;
    case 'remove':
      await handleRemove(interaction);
      return;
    default:
      console.error(`[setting] unknown subcommand: ${subcommand}`);
      await interaction.reply({
        content: '알 수 없는 명령입니다.',
        flags: MessageFlags.Ephemeral,
      });
  }
}

/** 디스코드는 자동완성 선택지를 25개까지 받는다. */
const AUTOCOMPLETE_LIMIT = 25;

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.respond([]);
      return;
    }

    // 자동완성 목록에서는 채널 멘션이 렌더링되지 않으므로 채널 이름을 직접 넣는다.
    const nameOf = (channelId: string): string => {
      const channel = interaction.guild?.channels.cache.get(channelId);
      return channel ? `#${channel.name}` : `(삭제됨 ${channelId})`;
    };

    const choices = listTranslations(guildId)
      .slice(0, AUTOCOMPLETE_LIMIT)
      .map((setting) => ({
        name: `${nameOf(setting.sourceChannelId)} → ${nameOf(setting.targetChannelId)} (${languageLabel(setting.targetLanguage)})`.slice(
          0,
          100
        ),
        value: setting.id,
      }));

    await interaction.respond(choices);
  } catch (error) {
    console.error('[setting] autocomplete failed', error);
    // 자동완성 실패가 커맨드 전체를 막지 않게 한다
    await interaction.respond([]).catch(() => undefined);
  }
}
```

- [ ] **Step 6: 테스트와 타입 체크**

Run: `npm test`
Expected: PASS — 총 35개 통과 (기존 커맨드 구조 테스트 5개가 깨지지 않았는지 확인)

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 7: Commit**

```bash
git add src/commands/setting.ts
git commit -m "feat: implement /setting register, list, remove handlers"
```

---

## Task 5: 인터랙션 라우팅과 구동 시 초기화

**Files:**
- Create: `src/events/interactionCreate.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `execute`, `autocomplete`, `data` — `src/commands/setting.ts`. `initialize` — `src/services/configService.ts`
- Produces: `handleInteraction(interaction: Interaction): Promise<void>` — `src/events/interactionCreate.ts`

- [ ] **Step 1: 라우팅 모듈 작성**

`src/events/interactionCreate.ts`:

```typescript
import { MessageFlags, type Interaction } from 'discord.js';
import { autocomplete as settingAutocomplete, data as settingData, execute as settingExecute } from '../commands/setting';

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === settingData.name) {
      await settingAutocomplete(interaction);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== settingData.name) return;

  try {
    await settingExecute(interaction);
  } catch (error) {
    console.error('[interactionCreate] command handler threw', error);
    const message = {
      content: '명령 처리 중 오류가 발생했습니다.',
      flags: MessageFlags.Ephemeral as const,
    };
    // 이미 응답했다면 followUp을, 아니라면 reply를 써야 한다
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message).catch(() => undefined);
    } else {
      await interaction.reply(message).catch(() => undefined);
    }
  }
}
```

- [ ] **Step 2: index.ts 수정**

`src/index.ts` 전체를 다음으로 교체한다:

```typescript
import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initialize as initializeConfig } from './services/configService';
import { handleInteraction } from './events/interactionCreate';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN must be set in .env');
}

// 설정을 읽지 못한 채 봇이 떠 있는 것보다 기동 실패가 낫다
initializeConfig();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, handleInteraction);

client.login(token);
```

- [ ] **Step 3: 타입 체크와 테스트**

Run: `npm run typecheck`
Expected: 에러 없이 종료

Run: `npm test`
Expected: PASS — 총 35개 통과

- [ ] **Step 4: Commit**

```bash
git add src/events/interactionCreate.ts src/index.ts
git commit -m "feat: route interactions and load config at startup"
```

---

## Task 6: 수동 검증 (실제 디스코드 필요)

**Files:** 없음 (검증만)

**Interfaces:**
- Consumes: Task 1~5의 전체 결과물

이 태스크는 **사람이 실행한다.** 실제 봇 토큰과 디스코드 서버가 필요하므로 에이전트가 수행할 수 없다. 에이전트는 이 태스크를 건너뛰고, 컨트롤러가 사용자에게 아래 체크리스트를 전달한다.

- [ ] **Step 1: 봇 실행**

Run: `npm start`
Expected: `Logged in as <봇이름>` 출력. `initializeConfig()`가 먼저 실행되므로 `src/store/config.json`이 생성된다.

- [ ] **Step 2: 시나리오 검증**

디스코드에서 순서대로 확인한다:

| # | 동작 | 기대 결과 |
|---|---|---|
| 1 | `/setting register` 원본·출력 채널을 서로 다르게, 언어 선택 | "설정을 등록했습니다" + 등록 내용. 본인에게만 보임 |
| 2 | `/setting list` | 방금 등록한 설정이 채널 멘션으로 표시 |
| 3 | 같은 원본 채널로 `/setting register` 다시, 언어를 다르게 | "설정을 변경했습니다" + 이전/변경 내용 두 줄. `list`는 여전히 1개 |
| 4 | `/setting register` 원본과 출력을 **같은 채널**로 | "원본 채널과 출력 채널이 같습니다" 거부 |
| 5 | 봇이 볼 수 없는 채널을 출력으로 지정 | "봇에게 필요한 권한이 없어…" + 부족한 권한 목록 |
| 6 | `/setting remove`에서 `id` 옵션에 커서 | 자동완성 드롭다운에 `#원본 → #출력 (언어)` 표시 |
| 7 | 목록에서 선택해 삭제 | "설정을 삭제했습니다" + 삭제된 내용 |
| 8 | `Ctrl+C` 후 `npm start` 재실행, `/setting list` | 5번에서 등록한 설정이 그대로 유지 |

- [ ] **Step 3: 설정 파일 확인**

Run: `cat src/store/config.json`
Expected: `version`, `guilds`, 길드 ID 아래 `translations` 배열이 있는 JSON. `git status`에 나타나지 않아야 한다(gitignore).

---

## Phase 2 완료 조건

- `npm test` — 총 35개 테스트 통과 (Phase 1의 15개 + configService 15개 + channelPermissions 5개)
- `npm run typecheck` — exit 0
- Task 6의 수동 시나리오 8개 전부 통과
- `src/store/config.json`이 생성되고 gitignore 되며, 봇 재시작 후에도 설정이 유지됨
- Phase 3(번역 파이프라인)은 별도 plan에서 다룬다
