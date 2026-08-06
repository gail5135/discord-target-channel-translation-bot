# Phase 1 (기본 골격) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** discord.js 봇이 실제로 로그인되고, JSON 파일 저장소가 로드/원자적 저장/백업 폴백까지 동작하고, `/setting` 슬래시 커맨드가 테스트 서버에 배포되는 상태까지 만든다. (설정 커맨드의 실제 로직·번역 파이프라인은 이후 별도 plan에서 다룬다.)

**Architecture:** `src/index.ts`가 discord.js 클라이언트를 초기화하고 로그인한다. `src/store/jsonStore.ts`는 `config.json`을 메모리로 로드/원자적 저장하는 순수 함수 모듈로, discord.js와 무관하게 독립적으로 테스트한다. `src/commands/setting.ts`는 `/setting` 커맨드의 구조(이름·서브커맨드·파라미터)만 정의하고, `src/deploy-commands.ts`가 이를 Discord REST API로 테스트 서버에 등록한다. 빌드 단계 없이 `ts-node`로 TS를 직접 실행한다.

**Tech Stack:** TypeScript, Node.js 22+, discord.js v14, ts-node, dotenv, Node 내장 테스트 러너(`node:test` + `node:assert/strict`)

## Global Constraints

- Node.js 22 LTS 이상, TypeScript, `ts-node`로 직접 실행 (별도 빌드 단계 없음) — CLAUDE.md 기술 스택
- discord.js v14.x 사용 — CLAUDE.md 기술 스택
- 설정 저장소는 JSON 파일만 사용 (DB 금지), 쓰기는 임시 파일 기록 후 `fs.rename`으로 교체하는 원자적 쓰기, 교체 직전 `.bak` 로컬 백업 — CLAUDE.md 확정된 설계 결정
- e2-micro(RAM 약 1GB) 배포를 고려해 무거운 의존성 추가를 피한다 — CLAUDE.md 주의사항
- 슬래시 커맨드/파라미터 이름은 영어 소문자+하이픈, `SlashCommandBuilder.addSubcommand()` 구조, description 문구는 한국어 — CLAUDE.md 확정된 설계 결정
- 채널 파라미터는 `ChannelType.GuildText`로 텍스트 채널만 선택 가능하도록 제한 — dev-plan.md 5장
- 봇 토큰 등 민감 정보는 `.env`로만 관리하고 절대 커밋하지 않는다 — CLAUDE.md 주의사항
- 이 프로젝트 폴더 자체가 독립된 git 저장소다(`git init`으로 새로 생성됨, 상위 홈 디렉토리 저장소와 무관). 그래도 커밋 시 `git add -A`/`git add .` 대신 변경한 파일 경로를 하나씩 명시해서 스테이징한다.

---

## Task 1: 리포지토리 스캐폴딩

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `npm run start`, `npm run deploy-commands`, `npm test`, `npm run typecheck` 스크립트. 이후 모든 태스크가 이 스크립트들을 사용한다.

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "discord-translation-bot",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "start": "ts-node src/index.ts",
    "deploy-commands": "ts-node src/deploy-commands.ts",
    "test": "node -r ts-node/register --test \"src/**/*.test.ts\"",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "discord.js": "^14.27.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "ts-node": "^10.9.2",
    "@types/node": "^22.10.0"
  }
}
```

- [ ] **Step 2: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: .gitignore 작성**

```
node_modules/
.env
src/store/config.json
src/store/config.json.bak
*.tmp
.DS_Store
```

- [ ] **Step 4: .env.example 작성**

```
# discord.js 클라이언트 로그인 토큰 (Developer Portal > Bot > Token)
DISCORD_TOKEN=

# 애플리케이션(클라이언트) ID (Developer Portal > General Information > Application ID)
DISCORD_CLIENT_ID=

# 슬래시 커맨드를 즉시 반영해서 테스트할 길드(서버) ID. 길드 단위 등록은 즉시 반영되고,
# 글로벌 등록은 최대 1시간까지 걸리므로 개발 중에는 길드 등록을 사용한다.
DISCORD_TEST_GUILD_ID=
```

- [ ] **Step 5: 의존성 설치**

Run: `npm install`
Expected: `node_modules/`와 `package-lock.json`이 생성되고 에러 없이 종료

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example
git commit -m "chore: scaffold TypeScript/discord.js project"
```

---

## Task 2: JSON 파일 저장소 (jsonStore.ts)

**Files:**
- Create: `src/types/index.ts`
- Create: `src/store/jsonStore.ts`
- Test: `src/store/jsonStore.test.ts`

**Interfaces:**
- Consumes: 없음 (discord.js와 무관한 순수 로직)
- Produces:
  - `loadStore(filePath: string): StoreData` — `src/store/jsonStore.ts`
  - `saveStore(filePath: string, data: StoreData): void` — `src/store/jsonStore.ts`
  - `StoreData`, `GuildConfig`, `TranslationConfig`, `WebhookCacheEntry` 타입 — `src/types/index.ts`
  - 이후 Phase 2의 `configService.ts`가 이 두 함수를 호출해 설정을 읽고 쓴다.

- [ ] **Step 1: 타입 정의 작성**

`src/types/index.ts`:

```typescript
export interface TranslationConfig {
  id: string;
  sourceChannelId: string;
  targetChannelId: string;
  targetLanguage: string; // ISO 639-1 (예: 'ko', 'en')
  createdAt: string; // ISO 8601
}

export interface WebhookCacheEntry {
  webhookId: string;
  webhookToken: string;
}

export interface GuildConfig {
  translations: TranslationConfig[];
  webhookCache: Record<string, WebhookCacheEntry>; // key: targetChannelId
}

export interface StoreData {
  version: number;
  guilds: Record<string, GuildConfig>; // key: guildId
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/store/jsonStore.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStore, saveStore } from './jsonStore';
import type { StoreData } from '../types';

function tempFilePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-test-'));
  return path.join(dir, 'config.json');
}

test('loadStore creates a default structure when the file does not exist', () => {
  const filePath = tempFilePath();

  const data = loadStore(filePath);

  assert.deepEqual(data, { version: 1, guilds: {} });
  assert.equal(fs.existsSync(filePath), true);
});

test('loadStore returns existing valid data unchanged', () => {
  const filePath = tempFilePath();
  const seed: StoreData = {
    version: 1,
    guilds: { '123': { translations: [], webhookCache: {} } },
  };
  fs.writeFileSync(filePath, JSON.stringify(seed));

  const data = loadStore(filePath);

  assert.deepEqual(data, seed);
});

test('loadStore falls back to the .bak file when the main file is corrupted', () => {
  const filePath = tempFilePath();
  const backup: StoreData = {
    version: 1,
    guilds: { '456': { translations: [], webhookCache: {} } },
  };
  fs.writeFileSync(`${filePath}.bak`, JSON.stringify(backup));
  fs.writeFileSync(filePath, '{ not valid json');

  const data = loadStore(filePath);

  assert.deepEqual(data, backup);
});

test('loadStore throws when both the main file and the backup are invalid', () => {
  const filePath = tempFilePath();
  fs.writeFileSync(filePath, '{ not valid json');
  fs.writeFileSync(`${filePath}.bak`, '{ also not valid json');

  assert.throws(() => loadStore(filePath));
});

test('saveStore writes the new data and backs up the previous version', () => {
  const filePath = tempFilePath();
  const first: StoreData = { version: 1, guilds: {} };
  saveStore(filePath, first);

  const second: StoreData = {
    version: 1,
    guilds: { '789': { translations: [], webhookCache: {} } },
  };
  saveStore(filePath, second);

  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.deepEqual(onDisk, second);
  const backup = JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf-8'));
  assert.deepEqual(backup, first);
});

test('saveStore creates the parent directory if it does not exist yet', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-test-'));
  const filePath = path.join(base, 'nested', 'config.json');

  saveStore(filePath, { version: 1, guilds: {} });

  assert.equal(fs.existsSync(filePath), true);
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './jsonStore'` (아직 구현 파일이 없음)

- [ ] **Step 4: jsonStore.ts 구현**

`src/store/jsonStore.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { StoreData } from '../types';

function isValidStoreData(data: unknown): data is StoreData {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Record<string, unknown>;
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.guilds === 'object' &&
    candidate.guilds !== null
  );
}

function readAndParse(filePath: string): StoreData | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return isValidStoreData(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function loadStore(filePath: string): StoreData {
  if (!fs.existsSync(filePath)) {
    const defaultData: StoreData = { version: 1, guilds: {} };
    saveStore(filePath, defaultData);
    return defaultData;
  }

  const main = readAndParse(filePath);
  if (main) return main;

  const backup = readAndParse(`${filePath}.bak`);
  if (backup) {
    console.error(`[jsonStore] ${filePath} is corrupted, recovered from .bak`);
    return backup;
  }

  throw new Error(`Config file corrupted and no valid backup found: ${filePath}`);
}

export function saveStore(filePath: string, data: StoreData): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  }

  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 6개 테스트 모두 통과

- [ ] **Step 6: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/store/jsonStore.ts src/store/jsonStore.test.ts
git commit -m "feat: add JSON store with atomic writes and .bak fallback"
```

---

## Task 3: `/setting` 슬래시 커맨드 정의 + 배포 스크립트

**Files:**
- Create: `src/commands/setting.ts`
- Test: `src/commands/setting.test.ts`
- Create: `src/deploy-commands.ts`

**Interfaces:**
- Consumes: 없음 (Task 2와 독립적)
- Produces:
  - `data: SlashCommandBuilder` — `src/commands/setting.ts` (Phase 2에서 `execute` 핸들러를 붙일 때 이 모듈을 확장한다)
  - `src/deploy-commands.ts`는 실행 스크립트로, 별도 export 없음

- [ ] **Step 1: 실패하는 테스트 작성**

`src/commands/setting.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data } from './setting';

test('setting command is named "setting"', () => {
  const json = data.toJSON();
  assert.equal(json.name, 'setting');
});

test('setting command has register, list, remove subcommands', () => {
  const json = data.toJSON();
  const names = (json.options ?? []).map((option) => option.name).sort();
  assert.deepEqual(names, ['list', 'register', 'remove']);
});

test('register subcommand has source-channel, target-channel, target-language options', () => {
  const json = data.toJSON();
  const register = (json.options ?? []).find((option) => option.name === 'register') as {
    options?: { name: string }[];
  };
  const optionNames = (register.options ?? []).map((option) => option.name).sort();
  assert.deepEqual(optionNames, ['source-channel', 'target-channel', 'target-language']);
});

test('remove subcommand has an id option', () => {
  const json = data.toJSON();
  const remove = (json.options ?? []).find((option) => option.name === 'remove') as {
    options?: { name: string }[];
  };
  assert.equal(remove.options?.[0]?.name, 'id');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './setting'`

- [ ] **Step 3: setting.ts 구현**

`src/commands/setting.ts`:

```typescript
import { SlashCommandBuilder, ChannelType } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('setting')
  .setDescription('번역 모니터링 채널·출력 채널·타겟 언어를 설정합니다')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('register')
      .setDescription('모니터링 채널·출력 채널·타겟 언어를 세트로 등록합니다')
      .addChannelOption((option) =>
        option
          .setName('source-channel')
          .setDescription('모니터링할 원본 채널')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addChannelOption((option) =>
        option
          .setName('target-channel')
          .setDescription('번역 결과를 게시할 출력 채널')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('target-language')
          .setDescription('타겟 언어 (ISO 639-1 코드, 예: ko, en, ja)')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(5)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('list').setDescription('현재 서버에 등록된 설정 목록을 확인합니다')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove')
      .setDescription('등록된 설정 세트를 삭제합니다')
      .addStringOption((option) =>
        option.setName('id').setDescription('삭제할 설정의 ID').setRequired(true)
      )
  );
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — Task 2의 6개 + 이번 4개, 총 10개 테스트 통과

- [ ] **Step 5: 배포 스크립트 구현**

`src/deploy-commands.ts`:

```typescript
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { data as settingCommand } from './commands/setting';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_TEST_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error(
    'DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_TEST_GUILD_ID must all be set in .env'
  );
}

const rest = new REST({ version: '10' }).setToken(token);

async function main(): Promise<void> {
  const commands = [settingCommand.toJSON()];
  await rest.put(Routes.applicationGuildCommands(clientId as string, guildId as string), {
    body: commands,
  });
  console.log(`Registered ${commands.length} command(s) to guild ${guildId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 6: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 7: 수동 검증 (실제 테스트 서버 필요)**

1. `.env`에 `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_TEST_GUILD_ID`를 실제 값으로 채운다 (Phase 0에서 만든 테스트용 봇/서버).
2. Run: `npm run deploy-commands`
3. Expected: 콘솔에 `Registered 1 command(s) to guild <id>` 출력
4. 디스코드 테스트 서버에서 `/setting`을 입력해 `register`/`list`/`remove` 서브커맨드가 자동완성 목록에 뜨는지 확인

- [ ] **Step 8: Commit**

```bash
git add src/commands/setting.ts src/commands/setting.test.ts src/deploy-commands.ts
git commit -m "feat: define /setting command and add deploy script"
```

---

## Task 4: discord.js 클라이언트 연결

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: 없음 (Phase 1 범위에서는 jsonStore/setting 커맨드를 아직 연결하지 않음 — 메시지·인터랙션 라우팅은 Phase 2/3에서 추가)
- Produces: 봇 프로세스 엔트리포인트. Phase 2의 `interactionCreate` 핸들러, Phase 3의 `messageCreate` 핸들러가 이 파일의 `client`에 이벤트 리스너를 추가하게 된다.

- [ ] **Step 1: index.ts 구현**

`src/index.ts`:

```typescript
import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN must be set in .env');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.login(token);
```

- [ ] **Step 2: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없이 종료

- [ ] **Step 3: 수동 검증 (실제 봇 토큰 필요)**

1. `.env`의 `DISCORD_TOKEN`이 채워져 있는지 확인
2. Run: `npm start`
3. Expected: 콘솔에 `Logged in as <봇이름>#<discriminator 또는 태그>` 출력
4. 디스코드 테스트 서버 멤버 목록에서 봇이 온라인 상태로 보이는지 확인
5. `Ctrl+C`로 프로세스 종료

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: connect discord.js client and confirm login"
```

---

## Phase 1 완료 조건

- `npm test` — Task 2, 3에서 작성한 10개 테스트 전부 통과
- `npm run typecheck` — 에러 없음
- `npm run deploy-commands` 실행 후 테스트 서버에 `/setting register|list|remove`가 보임
- `npm start` 실행 후 콘솔에 로그인 로그가 찍히고 봇이 테스트 서버에 온라인으로 표시됨
- Phase 2(설정 커맨드 실제 로직)부터는 별도 plan에서 다룬다
