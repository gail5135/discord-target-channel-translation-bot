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
