import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueue } from './messageQueue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 큐에 넣은 작업들이 끝날 때까지 이벤트 루프를 여러 번 넘긴다 */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

test('tasks on the same key run in order', async () => {
  const order: number[] = [];
  const first = deferred();

  enqueue('channel-1', async () => {
    await first.promise;
    order.push(1);
  });
  enqueue('channel-1', async () => {
    order.push(2);
  });

  await drain();
  assert.deepEqual(order, [], 'second task must not run before the first finishes');

  first.resolve();
  await drain();
  assert.deepEqual(order, [1, 2]);
});

test('tasks on different keys are not blocked by each other', async () => {
  const order: string[] = [];
  const blocked = deferred();

  enqueue('channel-1', async () => {
    await blocked.promise;
    order.push('slow');
  });
  enqueue('channel-2', async () => {
    order.push('fast');
  });

  await drain();
  assert.deepEqual(order, ['fast'], 'channel-2 must not wait for channel-1');

  blocked.resolve();
  await drain();
  assert.deepEqual(order, ['fast', 'slow']);
});

test('a task that throws does not block later tasks on the same key', async () => {
  const order: string[] = [];

  enqueue('channel-1', async () => {
    order.push('boom');
    throw new Error('task failed');
  });
  enqueue('channel-1', async () => {
    order.push('after');
  });

  await drain();
  assert.deepEqual(order, ['boom', 'after']);
});

test('a rejected task does not produce an unhandled rejection', async () => {
  let unhandled = false;
  const onUnhandled = (): void => {
    unhandled = true;
  };
  process.on('unhandledRejection', onUnhandled);

  enqueue('channel-x', async () => {
    throw new Error('nope');
  });
  await drain();

  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, false);
});
