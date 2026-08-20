import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitForDiscord, MAX_CONTENT } from './messageChunks';

const LIMIT = 2000;
const SUFFIX = '\nhttps://discord.com/channels/111111111111111111/222222222222222222/333333333333333333';

test('short text stays in one chunk with the suffix appended', () => {
  const chunks = splitForDiscord('hello', SUFFIX);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], `hello${SUFFIX}`);
});

test('every chunk stays within the discord limit', () => {
  const chunks = splitForDiscord('a'.repeat(5000), SUFFIX);

  for (const chunk of chunks) {
    assert.ok(chunk.length <= LIMIT, `chunk of ${chunk.length} exceeds ${LIMIT}`);
  }
});

test('text that fits alone but overflows with the suffix still respects the limit', () => {
  // 이 구간이 순진한 구현이 깨지는 지점이다: 본문은 2000 이하지만 접미사를 더하면 넘는다
  const text = 'a'.repeat(LIMIT - 10);

  const chunks = splitForDiscord(text, SUFFIX);

  for (const chunk of chunks) {
    assert.ok(chunk.length <= LIMIT, `chunk of ${chunk.length} exceeds ${LIMIT}`);
  }
});

test('the suffix lands on the last chunk only', () => {
  const chunks = splitForDiscord('b'.repeat(5000), SUFFIX);

  assert.ok(chunks.length > 1);
  assert.ok(chunks[chunks.length - 1].endsWith(SUFFIX));
  for (const chunk of chunks.slice(0, -1)) {
    assert.ok(!chunk.includes(SUFFIX));
  }
});

test('no characters are lost or duplicated', () => {
  const text = 'c'.repeat(4321);

  const chunks = splitForDiscord(text, SUFFIX);

  const rejoined = chunks.join('').slice(0, -SUFFIX.length);
  assert.equal(rejoined, text);
});

test('empty text yields a single chunk holding just the suffix', () => {
  const chunks = splitForDiscord('', SUFFIX);

  assert.deepEqual(chunks, [SUFFIX]);
});

test('does not split a surrogate pair across chunks', () => {
  // 이모지가 2000자 경계에 정확히 걸치도록 배치한다
  const text = 'a'.repeat(MAX_CONTENT - 1) + '🎉' + 'b'.repeat(100);

  const chunks = splitForDiscord(text, SUFFIX);

  for (const chunk of chunks) {
    assert.ok(chunk.length <= MAX_CONTENT);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(chunk), 'lone high surrogate');
    assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(chunk), 'lone low surrogate');
  }
  assert.ok(chunks.join('').includes('🎉'));
});
