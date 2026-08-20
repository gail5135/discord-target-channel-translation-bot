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

test('tasks beyond the depth cap are dropped rather than queued', async () => {
  const started: number[] = [];
  const gate = deferred();

  // 첫 작업이 게이트를 잡고 있는 동안 상한을 넘겨 투입한다
  for (let i = 0; i < 60; i += 1) {
    enqueue('channel-cap', async () => {
      started.push(i);
      if (i === 0) await gate.promise;
    });
  }

  gate.resolve();
  // drain()의 20 마이크로태스크 틱은 체인 50단 깊이를 다 소진하기에 부족하다(실측 필요 틱 수가 훨씬 큼).
  // 매크로태스크 한 틱을 기다리면 그 사이에 예약되는 마이크로태스크가 전부 처리된다.
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(started.length, 50, 'only up to the cap should run');
  assert.equal(started[0], 0);
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
  // drain()은 마이크로태스크만 20틱 넘긴다. Node는 그 틱의 마이크로태스크 큐가 완전히
  // 빈 뒤에야 unhandledRejection을 발생시키므로, drain()만으로는 진짜 누수도 감지되지 않는다
  // (실측: 누수가 있는 구현도 drain() 뒤 unhandled === false였다가 매크로태스크 한 틱 뒤에 true가 됐다).
  await new Promise((resolve) => setImmediate(resolve));

  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, false);
});
