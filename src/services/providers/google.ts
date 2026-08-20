import type { LanguageCode } from '../../types';
import type { FetchLike, TranslationProvider, TranslationResult } from './types';

/**
 * 봇 내부 코드 → Google 코드. 대부분 동일하지만, 지원 목록을 명시해두면
 * 오타나 미지원 언어가 API 호출 전에 걸린다.
 */
const TO_GOOGLE: Record<LanguageCode, string> = {
  ko: 'ko',
  en: 'en',
  ja: 'ja',
  'zh-CN': 'zh-CN',
  es: 'es',
  fr: 'fr',
  de: 'de',
  ru: 'ru',
  it: 'it',
  id: 'id',
};

/** Google 감지 결과 → 봇 내부 코드. 중국어만 표기가 갈린다. */
const FROM_GOOGLE: Record<string, string> = {
  zh: 'zh-CN',
  'zh-CN': 'zh-CN',
  'zh-Hans': 'zh-CN',
};

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const TIMEOUT_MS = 10_000;

/** Google은 번역문을 HTML 이스케이프해서 돌려준다. 디스코드에 그대로 올리면 &#39; 같은 게 보인다. */
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

function decodeHtmlEntities(input: string): string {
  // &amp;를 마지막에 처리하면 '&amp;lt;'가 '<'로 잘못 풀린다. 정규식 한 번으로 동시에 치환한다.
  return input.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (match) => HTML_ENTITIES[match] ?? match);
}

interface GoogleResponse {
  data?: { translations?: { translatedText?: string; detectedSourceLanguage?: string }[] };
}

export function createGoogleProvider(
  apiKey: string,
  fetchImpl: FetchLike = fetch
): TranslationProvider {
  return {
    name: 'google',
    async translate(text: string, targetLanguage: string): Promise<TranslationResult> {
      // config.json은 손으로 편집할 수 있으므로(사양서 4.2.1) 런타임 값이 LanguageCode가 아닐 수 있다.
      const target = Object.prototype.hasOwnProperty.call(TO_GOOGLE, targetLanguage)
        ? TO_GOOGLE[targetLanguage as LanguageCode]
        : undefined;
      if (!target) {
        throw new Error(`google: unsupported target language "${targetLanguage}"`);
      }

      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
        body: JSON.stringify({ q: text, target, format: 'text' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`google: HTTP ${response.status}`);
      }

      const data = (await response.json()) as GoogleResponse;
      const first = data.data?.translations?.[0];
      if (!first || typeof first.translatedText !== 'string') {
        throw new Error('google: response contained no translation');
      }

      const detected = first.detectedSourceLanguage ?? '';
      return {
        text: decodeHtmlEntities(first.translatedText),
        detectedSourceLanguage: FROM_GOOGLE[detected] ?? detected,
      };
    },
  };
}
