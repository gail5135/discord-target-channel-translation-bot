import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeepLProvider, deeplEndpoint } from './deepl';
import type { FetchLike } from './types';

/** 마지막 요청을 기록하면서 정해진 응답을 돌려주는 가짜 fetch */
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

test('deeplEndpoint picks the free host for keys ending in :fx', () => {
  assert.equal(deeplEndpoint('abc-123:fx'), 'https://api-free.deepl.com/v2/translate');
});

test('deeplEndpoint picks the paid host otherwise', () => {
  assert.equal(deeplEndpoint('abc-123'), 'https://api.deepl.com/v2/translate');
});

test('translate returns the translated text', async () => {
  const { impl } = fakeFetch(200, {
    translations: [{ detected_source_language: 'EN', text: '안녕하세요' }],
  });
  const provider = createDeepLProvider('key:fx', impl);

  const result = await provider.translate('hello', 'ko');

  assert.equal(result.text, '안녕하세요');
});

test('translate normalizes the detected language to internal codes', async () => {
  const { impl } = fakeFetch(200, {
    translations: [{ detected_source_language: 'ZH', text: 'hi' }],
  });
  const provider = createDeepLProvider('key:fx', impl);

  const result = await provider.translate('你好', 'en');

  assert.equal(result.detectedSourceLanguage, 'zh-CN');
});

test('translate maps en to EN-US in the request', async () => {
  const { impl, calls } = fakeFetch(200, {
    translations: [{ detected_source_language: 'KO', text: 'hello' }],
  });
  const provider = createDeepLProvider('key:fx', impl);

  await provider.translate('안녕', 'en');

  const body = String(calls[0].init?.body);
  assert.match(body, /"target_lang":"EN-US"/);
});

test('translate maps zh-CN to ZH in the request', async () => {
  const { impl, calls } = fakeFetch(200, {
    translations: [{ detected_source_language: 'KO', text: '你好' }],
  });
  const provider = createDeepLProvider('key:fx', impl);

  await provider.translate('안녕', 'zh-CN');

  const body = String(calls[0].init?.body);
  assert.match(body, /"target_lang":"ZH"/);
});

test('translate sends the key in the Authorization header', async () => {
  const { impl, calls } = fakeFetch(200, {
    translations: [{ detected_source_language: 'EN', text: '안녕' }],
  });
  const provider = createDeepLProvider('secret:fx', impl);

  await provider.translate('hello', 'ko');

  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'DeepL-Auth-Key secret:fx');
});

test('translate throws on a non-2xx response', async () => {
  const { impl } = fakeFetch(456, { message: 'Quota exceeded' });
  const provider = createDeepLProvider('key:fx', impl);

  await assert.rejects(() => provider.translate('hello', 'ko'), /456/);
});

test('translate throws when the response has no translations', async () => {
  const { impl } = fakeFetch(200, { translations: [] });
  const provider = createDeepLProvider('key:fx', impl);

  await assert.rejects(() => provider.translate('hello', 'ko'));
});

test('translate rejects an unsupported target language', async () => {
  const { impl } = fakeFetch(200, {
    translations: [{ detected_source_language: 'EN', text: 'x' }],
  });
  const provider = createDeepLProvider('key:fx', impl);

  await assert.rejects(() => provider.translate('hello', 'xx'), /xx/);
});
