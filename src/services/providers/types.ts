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
