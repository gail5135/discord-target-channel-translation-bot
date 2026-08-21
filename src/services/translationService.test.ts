import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AllProvidersFailedError,
  createTranslator,
  initializeTranslator,
  resetTranslatorForTests,
  translate,
} from './translationService';
import type { TranslationProvider } from './providers/types';

function ok(name: string, text: string, detected = 'en'): TranslationProvider {
  return {
    name,
    translate: async () => ({ text, detectedSourceLanguage: detected }),
  };
}

function failing(name: string, message: string): TranslationProvider {
  return {
    name,
    translate: async () => {
      throw new Error(message);
    },
  };
}

test('translate uses the first provider when it succeeds', async () => {
  const calls: string[] = [];
  const first: TranslationProvider = {
    name: 'first',
    translate: async () => {
      calls.push('first');
      return { text: 'A', detectedSourceLanguage: 'en' };
    },
  };
  const second: TranslationProvider = {
    name: 'second',
    translate: async () => {
      calls.push('second');
      return { text: 'B', detectedSourceLanguage: 'en' };
    },
  };
  const translate = createTranslator([first, second]);

  const result = await translate('hello', 'ko');

  assert.equal(result.text, 'A');
  assert.deepEqual(calls, ['first']);
});

test('translate falls back to the next provider when the first fails', async () => {
  const translate = createTranslator([failing('first', 'boom'), ok('second', 'B')]);

  const result = await translate('hello', 'ko');

  assert.equal(result.text, 'B');
});

test('translate tries providers in the given order', async () => {
  const calls: string[] = [];
  const track = (name: string): TranslationProvider => ({
    name,
    translate: async () => {
      calls.push(name);
      throw new Error('nope');
    },
  });
  const translate = createTranslator([track('a'), track('b'), track('c')]);

  await assert.rejects(() => translate('hello', 'ko'));

  assert.deepEqual(calls, ['a', 'b', 'c']);
});

test('translate throws AllProvidersFailedError when every provider fails', async () => {
  const translate = createTranslator([failing('a', 'one down'), failing('b', 'two down')]);

  await assert.rejects(
    () => translate('hello', 'ko'),
    (error: unknown) => {
      assert.ok(error instanceof AllProvidersFailedError);
      assert.deepEqual(
        error.attempts.map((attempt) => attempt.provider),
        ['a', 'b']
      );
      assert.match(error.attempts[0].message, /one down/);
      return true;
    }
  );
});

test('translate throws AllProvidersFailedError when there are no providers', async () => {
  const translate = createTranslator([]);

  await assert.rejects(() => translate('hello', 'ko'), AllProvidersFailedError);
});

test('the error message names every provider that was tried', async () => {
  const translate = createTranslator([failing('a', 'one down'), failing('b', 'two down')]);

  await assert.rejects(
    () => translate('hello', 'ko'),
    (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, /a/);
      assert.match(message, /b/);
      return true;
    }
  );
});

/** process.env는 전역이다. 바꾼 값을 반드시 되돌린다. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** 어떤 제공자가 등록됐는지는 기동 로그가 유일하게 관찰 가능한 신호다. */
function captureLog(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

test('a provider that throws a non-Error is still reported by name', async () => {
  const provider: TranslationProvider = {
    name: 'weird',
    translate: async () => {
      // 제공자가 Error가 아닌 값을 던지는 경우 (예: 라이브러리가 문자열을 throw)
      throw 'plain string failure';
    },
  };
  const translateOne = createTranslator([provider]);

  await assert.rejects(
    () => translateOne('hello', 'ko'),
    (error: unknown) => {
      assert.ok(error instanceof AllProvidersFailedError);
      assert.equal(error.attempts[0].provider, 'weird');
      assert.equal(error.attempts[0].message, 'plain string failure');
      return true;
    }
  );
});

test('initializeTranslator registers deepl before google when both keys are set', () => {
  const lines = withEnv({ DEEPL_API_KEY: 'deepl-key', GOOGLE_TRANSLATE_API_KEY: 'google-key' }, () =>
    captureLog(() => initializeTranslator())
  );

  assert.ok(
    lines.some((line) => line.includes('providers: deepl -> google')),
    lines.join('\n')
  );
});

test('initializeTranslator registers google alone when only its key is set', () => {
  const lines = withEnv({ DEEPL_API_KEY: undefined, GOOGLE_TRANSLATE_API_KEY: 'google-key' }, () =>
    captureLog(() => initializeTranslator())
  );

  assert.ok(
    lines.some((line) => line.includes('providers: google')),
    lines.join('\n')
  );
});

test('initializeTranslator treats a whitespace-only key as absent', () => {
  withEnv({ DEEPL_API_KEY: '   ', GOOGLE_TRANSLATE_API_KEY: undefined }, () => {
    assert.throws(() => initializeTranslator(), /DEEPL_API_KEY/);
  });
});

test('initializeTranslator throws when no provider key is configured', () => {
  withEnv({ DEEPL_API_KEY: undefined, GOOGLE_TRANSLATE_API_KEY: undefined }, () => {
    assert.throws(() => initializeTranslator(), /GOOGLE_TRANSLATE_API_KEY/);
  });
});

// 이 테스트는 모듈 수준 상태를 비운다. 스스로 리셋하므로 선언 순서에 의존하지 않는다.
test('translate throws before initializeTranslator has run', () => {
  resetTranslatorForTests();

  assert.throws(() => translate('hello', 'ko'), /initializeTranslator\(\) must be called/);
});
