import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getWebhook,
  invalidateWebhook,
  resetWebhookCacheForTests,
  type WebhookHost,
  type WebhookLike,
} from './webhookService';

const BOT_ID = 'bot-1';

function webhook(id: string, ownerId: string | null): WebhookLike {
  return {
    id,
    owner: ownerId === null ? null : { id: ownerId },
    send: async () => undefined,
  };
}

/**
 * fetchWebhooks/createWebhook 호출 횟수를 세는 최소 채널.
 * 카운터를 host 밖에 두는 이유는, host 안에 두고 메서드에서 host.fetchCount를 참조하면
 * TypeScript가 자기 자신을 참조하는 초기화자에서 타입을 추론하지 못해 컴파일이 깨지기 때문이다.
 */
function fakeChannel(
  channelId: string,
  existing: WebhookLike[]
): { host: WebhookHost; counts: { fetch: number; create: number } } {
  const counts = { fetch: 0, create: 0 };
  const host: WebhookHost = {
    id: channelId,
    async fetchWebhooks() {
      counts.fetch += 1;
      return {
        find: (fn: (w: WebhookLike) => boolean) => existing.find(fn),
      };
    },
    async createWebhook() {
      counts.create += 1;
      const created = webhook(`created-${channelId}`, BOT_ID);
      existing.push(created);
      return created;
    },
  };
  return { host, counts };
}

beforeEach(() => {
  resetWebhookCacheForTests();
});

test('creates a webhook when the channel has none', async () => {
  const { host, counts } = fakeChannel('c1', []);

  const result = await getWebhook(host, BOT_ID);

  assert.equal(result?.id, 'created-c1');
  assert.equal(counts.create, 1);
});

test('reuses a webhook the bot already owns', async () => {
  const { host, counts } = fakeChannel('c1', [webhook('existing', BOT_ID)]);

  const result = await getWebhook(host, BOT_ID);

  assert.equal(result?.id, 'existing');
  assert.equal(counts.create, 0);
});

test('ignores webhooks owned by someone else', async () => {
  const { host, counts } = fakeChannel('c1', [webhook('theirs', 'other-bot')]);

  const result = await getWebhook(host, BOT_ID);

  assert.equal(result?.id, 'created-c1', 'must not borrow another owner webhook');
  assert.equal(counts.create, 1);
});

test('ignores webhooks with no owner', async () => {
  const { host, counts } = fakeChannel('c1', [webhook('ownerless', null)]);

  const result = await getWebhook(host, BOT_ID);

  assert.equal(result?.id, 'created-c1');
  assert.equal(counts.create, 1);
});

test('caches so the second call does not hit the api', async () => {
  const { host, counts } = fakeChannel('c1', []);

  await getWebhook(host, BOT_ID);
  await getWebhook(host, BOT_ID);

  assert.equal(counts.fetch, 1);
  assert.equal(counts.create, 1);
});

test('different channels are cached independently', async () => {
  const first = fakeChannel('c1', []);
  const second = fakeChannel('c2', []);

  const a = await getWebhook(first.host, BOT_ID);
  const b = await getWebhook(second.host, BOT_ID);

  assert.equal(a?.id, 'created-c1');
  assert.equal(b?.id, 'created-c2');
});

test('invalidate forces the next call to fetch again', async () => {
  const { host, counts } = fakeChannel('c1', []);
  await getWebhook(host, BOT_ID);

  invalidateWebhook('c1');
  await getWebhook(host, BOT_ID);

  assert.equal(counts.fetch, 2);
});

test('returns undefined when fetching throws', async () => {
  const channel: WebhookHost = {
    id: 'c1',
    fetchWebhooks: async () => {
      throw new Error('Missing Permissions');
    },
    createWebhook: async () => webhook('never', BOT_ID),
  };

  assert.equal(await getWebhook(channel, BOT_ID), undefined);
});

test('returns undefined when creating throws', async () => {
  const channel: WebhookHost = {
    id: 'c1',
    fetchWebhooks: async () => ({ find: () => undefined }),
    createWebhook: async () => {
      throw new Error('Missing Permissions');
    },
  };

  assert.equal(await getWebhook(channel, BOT_ID), undefined);
});

test('a failed lookup is not cached', async () => {
  let shouldFail = true;
  const channel: WebhookHost = {
    id: 'c1',
    fetchWebhooks: async () => {
      if (shouldFail) throw new Error('Missing Permissions');
      return { find: () => webhook('recovered', BOT_ID) };
    },
    createWebhook: async () => webhook('never', BOT_ID),
  };

  assert.equal(await getWebhook(channel, BOT_ID), undefined);
  shouldFail = false;
  assert.equal((await getWebhook(channel, BOT_ID))?.id, 'recovered');
});

test('concurrent calls for one channel create only one webhook', async () => {
  const { host, counts } = fakeChannel('c1', []);

  // await 없이 동시에 호출한다 — N:1 구성에서 실제로 일어나는 형태
  const [first, second] = await Promise.all([
    getWebhook(host, BOT_ID),
    getWebhook(host, BOT_ID),
  ]);

  assert.equal(counts.create, 1, 'a second webhook must not be created');
  assert.equal(counts.fetch, 1);
  assert.equal(first?.id, second?.id);
});

test('a failed concurrent lookup is still not cached', async () => {
  let shouldFail = true;
  const channel: WebhookHost = {
    id: 'c1',
    fetchWebhooks: async () => {
      if (shouldFail) throw new Error('Missing Permissions');
      return { find: () => webhook('recovered', BOT_ID) };
    },
    createWebhook: async () => webhook('never', BOT_ID),
  };

  await Promise.all([getWebhook(channel, BOT_ID), getWebhook(channel, BOT_ID)]);
  shouldFail = false;

  assert.equal((await getWebhook(channel, BOT_ID))?.id, 'recovered');
});
