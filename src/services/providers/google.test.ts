import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleProvider } from './google';
import type { FetchLike } from './types';

function fakeFetch(
  status: number,
  body: unknown
): { impl: FetchLike; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as FetchLike;
  return { impl, calls };
}

test('translate returns the translated text', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: '안녕하세요', detectedSourceLanguage: 'en' }] },
  });
  const provider = createGoogleProvider('key', impl);

  const result = await provider.translate('hello', 'ko');

  assert.equal(result.text, '안녕하세요');
  assert.equal(result.detectedSourceLanguage, 'en');
});

test('translate decodes HTML entities in the result', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'it&#39;s &amp; &quot;ok&quot;', detectedSourceLanguage: 'ko' }] },
  });
  const provider = createGoogleProvider('key', impl);

  const result = await provider.translate('그건 괜찮아', 'en');

  assert.equal(result.text, 'it\'s & "ok"');
});

test('translate sends the api key as a header', async () => {
  const { impl, calls } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'hi', detectedSourceLanguage: 'ko' }] },
  });
  const provider = createGoogleProvider('secret', impl);

  await provider.translate('안녕', 'en');

  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers['X-goog-api-key'], 'secret');
  assert.ok(!calls[0].url.includes('secret'), 'key must not appear in the url');
});

test('translate sends the target language in the body', async () => {
  const { impl, calls } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'hi', detectedSourceLanguage: 'ko' }] },
  });
  const provider = createGoogleProvider('key', impl);

  await provider.translate('안녕', 'zh-CN');

  const body = String(calls[0].init?.body);
  assert.match(body, /"target":"zh-CN"/);
});

test('translate throws on a non-2xx response', async () => {
  const { impl } = fakeFetch(403, { error: { message: 'API key not valid' } });
  const provider = createGoogleProvider('key', impl);

  await assert.rejects(() => provider.translate('hello', 'ko'), /403/);
});

test('translate throws when the response has no translations', async () => {
  const { impl } = fakeFetch(200, { data: { translations: [] } });
  const provider = createGoogleProvider('key', impl);

  await assert.rejects(() => provider.translate('hello', 'ko'));
});

test('translate rejects an unsupported target language', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'x', detectedSourceLanguage: 'en' }] },
  });
  const provider = createGoogleProvider('key', impl);

  await assert.rejects(() => provider.translate('hello', 'xx'), /xx/);
});

test('a detected "zh" is normalized to the bot language code', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'hello', detectedSourceLanguage: 'zh' }] },
  });
  const provider = createGoogleProvider('key', impl);

  const result = await provider.translate('你好', 'en');

  assert.equal(result.detectedSourceLanguage, 'zh-CN');
});

test('a detected "zh-Hans" is normalized to the bot language code', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'hello', detectedSourceLanguage: 'zh-Hans' }] },
  });
  const provider = createGoogleProvider('key', impl);

  const result = await provider.translate('你好', 'en');

  assert.equal(result.detectedSourceLanguage, 'zh-CN');
});

test('a detected language with no alias is passed through unchanged', async () => {
  const { impl } = fakeFetch(200, {
    data: { translations: [{ translatedText: 'hello', detectedSourceLanguage: 'fr' }] },
  });
  const provider = createGoogleProvider('key', impl);

  const result = await provider.translate('bonjour', 'en');

  assert.equal(result.detectedSourceLanguage, 'fr');
});
