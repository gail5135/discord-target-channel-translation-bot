export interface TranslationConfig {
  id: string;
  sourceChannelId: string;
  targetChannelId: string;
  targetLanguage: string; // 봇 내부 표준 언어 코드 (예: 'ko', 'en', 'zh-CN'). 제공자별 코드 변환은 Phase 3에서 처리
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
