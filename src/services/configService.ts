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
      typeof candidate.webhookCache === 'object' &&
      candidate.webhookCache !== null &&
      !Array.isArray(candidate.webhookCache)
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
