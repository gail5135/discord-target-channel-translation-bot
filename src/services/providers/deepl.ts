import type { LanguageCode } from '../../types';
import type { FetchLike, TranslationProvider, TranslationResult } from './types';

/** 봇 내부 코드 → DeepL 타겟 코드. DeepL은 대문자를 요구하고 EN은 폐기되어 EN-US를 써야 한다. */
const TO_DEEPL: Record<LanguageCode, string> = {
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
      // config.json은 손으로 편집할 수 있으므로(사양서 4.2.1) 런타임 값이 LanguageCode가 아닐 수 있다.
      const target = Object.prototype.hasOwnProperty.call(TO_DEEPL, targetLanguage)
        ? TO_DEEPL[targetLanguage as LanguageCode]
        : undefined;
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
