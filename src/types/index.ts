/** 봇 내부 표준 언어 코드. /setting choices와 제공자 매핑이 모두 이 집합을 따른다. */
export type LanguageCode =
  | 'ko'
  | 'en'
  | 'ja'
  | 'zh-CN'
  | 'es'
  | 'fr'
  | 'de'
  | 'ru'
  | 'it'
  | 'id';

export interface TranslationConfig {
  id: string;
  sourceChannelId: string;
  targetChannelId: string;
  targetLanguage: string; // 봇 내부 표준 언어 코드 (예: 'ko', 'en', 'zh-CN'). 제공자별 코드 변환은 Phase 3에서 처리
  createdAt: string; // ISO 8601
}

export interface GuildConfig {
  translations: TranslationConfig[];
}

export interface StoreData {
  version: number;
  guilds: Record<string, GuildConfig>; // key: guildId
}
