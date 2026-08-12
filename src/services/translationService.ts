import { createDeepLProvider } from './providers/deepl';
import { createGoogleProvider } from './providers/google';
import type { TranslationProvider, TranslationResult } from './providers/types';

export interface ProviderAttempt {
  provider: string;
  message: string;
}

export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: readonly ProviderAttempt[]) {
    const detail = attempts.map((a) => `${a.provider}: ${a.message}`).join('; ');
    super(`all translation providers failed (${detail || 'no providers configured'})`);
    this.name = 'AllProvidersFailedError';
  }
}

export type Translate = (text: string, targetLanguage: string) => Promise<TranslationResult>;

/**
 * 실패 종류를 분류하지 않고 무조건 다음 제공자로 넘긴다.
 * "이 오류는 다음도 실패한다"는 판단이 틀렸을 때 잃는 것(번역 누락)이
 * 맞았을 때 아끼는 것(호출 1회)보다 크기 때문이다.
 */
export function createTranslator(providers: readonly TranslationProvider[]): Translate {
  return async (text: string, targetLanguage: string): Promise<TranslationResult> => {
    const attempts: ProviderAttempt[] = [];

    for (const provider of providers) {
      try {
        return await provider.translate(text, targetLanguage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push({ provider: provider.name, message });
        console.error(`[translation] ${provider.name} failed: ${message}`);
      }
    }

    throw new AllProvidersFailedError(attempts);
  };
}

let defaultTranslate: Translate | undefined;

/** 구동 시 1회 호출한다. 모듈 로드 시점에 env를 읽으면 테스트와 deploy-commands가 env에 묶인다. */
export function initializeTranslator(): void {
  const deeplKey = process.env.DEEPL_API_KEY?.trim();
  const googleKey = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();

  const providers: TranslationProvider[] = [];
  if (deeplKey) providers.push(createDeepLProvider(deeplKey));
  if (googleKey) providers.push(createGoogleProvider(googleKey));

  if (providers.length === 0) {
    throw new Error(
      'No translation provider configured. Set DEEPL_API_KEY and/or GOOGLE_TRANSLATE_API_KEY in .env'
    );
  }
  console.log(`[translation] providers: ${providers.map((p) => p.name).join(' -> ')}`);

  defaultTranslate = createTranslator(providers);
}

export function translate(text: string, targetLanguage: string): Promise<TranslationResult> {
  if (!defaultTranslate) {
    throw new Error('initializeTranslator() must be called before translate()');
  }
  return defaultTranslate(text, targetLanguage);
}
