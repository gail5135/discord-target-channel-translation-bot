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
