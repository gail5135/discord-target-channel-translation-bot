import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AllProvidersFailedError, createTranslator } from './translationService';
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
