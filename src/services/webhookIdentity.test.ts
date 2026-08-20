import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeWebhookUsername } from './webhookIdentity';

test('keeps an ordinary name unchanged', () => {
  assert.equal(sanitizeWebhookUsername('YomaNezz', 'yoma'), 'YomaNezz');
});

test('falls back when the preferred name is empty', () => {
  assert.equal(sanitizeWebhookUsername('', 'yoma'), 'yoma');
  assert.equal(sanitizeWebhookUsername('   ', 'yoma'), 'yoma');
});

test('falls back to Unknown when both names are unusable', () => {
  assert.equal(sanitizeWebhookUsername('', ''), 'Unknown');
});

test('truncates to 80 characters', () => {
  const result = sanitizeWebhookUsername('a'.repeat(120), 'fallback');

  assert.equal(result.length, 80);
});

test('strips the forbidden substring discord', () => {
  const result = sanitizeWebhookUsername('discord-fan', 'fallback');

  assert.ok(!/discord/i.test(result), `still contains discord: ${result}`);
});

test('strips the forbidden substring regardless of case', () => {
  const result = sanitizeWebhookUsername('DiScOrD hater', 'fallback');

  assert.ok(!/discord/i.test(result), `still contains discord: ${result}`);
});

test('strips the forbidden substring clyde', () => {
  const result = sanitizeWebhookUsername('clyde2', 'fallback');

  assert.ok(!/clyde/i.test(result), `still contains clyde: ${result}`);
});

test('rejects the reserved names everyone and here', () => {
  assert.equal(sanitizeWebhookUsername('everyone', 'fallback'), 'fallback');
  assert.equal(sanitizeWebhookUsername('here', 'fallback'), 'fallback');
  assert.equal(sanitizeWebhookUsername('HERE', 'fallback'), 'fallback');
});

test('falls back when stripping leaves nothing usable', () => {
  // 'discord'만으로 이루어진 이름은 제거 후 빈 문자열이 된다
  assert.equal(sanitizeWebhookUsername('discord', 'fallback'), 'fallback');
});

test('falls back to Unknown when the fallback is also unusable', () => {
  assert.equal(sanitizeWebhookUsername('discord', 'clyde'), 'Unknown');
});

test('does not leave a lone surrogate when truncating', () => {
  const result = sanitizeWebhookUsername('🎉'.repeat(60), 'fallback');

  assert.ok(result.length <= 80);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(result), 'lone high surrogate');
});

test('truncates after stripping, not before', () => {
  // 'discord'를 먼저 지우지 않으면 잘라낸 결과에 금지어가 남을 수 있다
  const result = sanitizeWebhookUsername('discord' + 'a'.repeat(80), 'fallback');

  assert.equal(result.length, 80);
  assert.ok(!/discord/i.test(result));
});
