import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCooldown } from './cooldown';

/** Date.now를 흉내 내는 수동 시계. 타이머를 쓰지 않아 테스트가 빠르고 흔들리지 않는다. */
function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

test('the first claim for a key succeeds', () => {
  const cooldown = createCooldown(1000, clock().now);

  assert.equal(cooldown.claim('a'), true);
});

test('a second claim inside the interval is refused', () => {
  const time = clock();
  const cooldown = createCooldown(1000, time.now);
  cooldown.claim('a');

  time.advance(999);

  assert.equal(cooldown.claim('a'), false);
});

test('a claim once the interval has elapsed succeeds again', () => {
  const time = clock();
  const cooldown = createCooldown(1000, time.now);
  cooldown.claim('a');

  time.advance(1000);

  assert.equal(cooldown.claim('a'), true);
});

test('keys are tracked independently', () => {
  const cooldown = createCooldown(1000, clock().now);

  assert.equal(cooldown.claim('a'), true);
  assert.equal(cooldown.claim('b'), true);
});

test('expired keys are swept so the map stays bounded', () => {
  const time = clock();
  const cooldown = createCooldown(1000, time.now);
  for (let i = 0; i < 100; i += 1) cooldown.claim(`channel-${i}`);
  assert.equal(cooldown.size(), 100);

  time.advance(1000);
  cooldown.claim('channel-fresh');

  assert.equal(cooldown.size(), 1);
});

test('keys still inside the interval survive the sweep', () => {
  const time = clock();
  const cooldown = createCooldown(1000, time.now);
  cooldown.claim('old');
  time.advance(600);
  cooldown.claim('recent');

  // t=1200 — old는 1200ms 전(만료), recent는 600ms 전(유효)
  time.advance(600);
  cooldown.claim('newest');

  assert.equal(cooldown.size(), 2);
  assert.equal(cooldown.claim('recent'), false);
});
