import { loadStore, saveStore } from '../store/jsonStore';
import { CONFIG_PATH } from '../store/configPath';
import type { GuildConfig, StoreData, TranslationConfig } from '../types';

let cache: StoreData | undefined;
let storePath: string = CONFIG_PATH;

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
    guilds[guildId] = normalizeGuild(guildId, guildData);
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

/** 모듈 수준 캐시가 테스트 사이에 새지 않도록 비운다. 운영 코드는 호출하지 않는다. */
export function resetConfigCacheForTests(): void {
  cache = undefined;
  storePath = CONFIG_PATH;
}

export function listTranslations(guildId: string): readonly Readonly<TranslationConfig>[] {
  return [...(requireCache().guilds[guildId]?.translations ?? [])];
}

export function findBySourceChannel(
  guildId: string,
  sourceChannelId: string
): Readonly<TranslationConfig> | undefined {
  return requireCache().guilds[guildId]?.translations.find(
    (translation) => translation.sourceChannelId === sourceChannelId
  );
}

export interface TranslationInput {
  sourceChannelId: string;
  targetChannelId: string;
  targetLanguage: string;
}

export interface UpsertResult {
  setting: Readonly<TranslationConfig>;
  replaced?: Readonly<TranslationConfig>;
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
  const guild = (draft.guilds[guildId] ??= { translations: [] });

  const index = guild.translations.findIndex(
    (translation) => translation.sourceChannelId === input.sourceChannelId
  );
  const replaced = index >= 0 ? guild.translations[index] : undefined;

  const setting: TranslationConfig = {
    id: replaced?.id ?? generateId(guild.translations),
    sourceChannelId: input.sourceChannelId,
    targetChannelId: input.targetChannelId,
    targetLanguage: input.targetLanguage,
    // 덮어쓰기는 새 설정이 아니라 같은 설정의 수정이다. id를 물려주는 것과 같은 이유로
    // createdAt도 물려준다 — 그러지 않으면 이름과 달리 "최종 수정 시각"이 된다.
    createdAt: replaced?.createdAt ?? new Date().toISOString(),
  };

  if (index >= 0) {
    guild.translations[index] = setting;
  } else {
    guild.translations.push(setting);
  }

  commit(draft);
  return replaced ? { setting, replaced } : { setting };
}

export function removeTranslation(
  guildId: string,
  id: string
): Readonly<TranslationConfig> | undefined {
  const draft = cloneStore(requireCache());
  const guild = draft.guilds[guildId];
  if (!guild) return undefined;

  const index = guild.translations.findIndex((translation) => translation.id === id);
  if (index < 0) return undefined;

  const [removed] = guild.translations.splice(index, 1);
  commit(draft);
  return removed;
}
