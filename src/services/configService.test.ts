import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as configService from './configService';
import type { StoreData } from '../types';

function tempConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'configservice-test-'));
  return path.join(dir, 'config.json');
}

function seed(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data));
}

test('initialize creates a default store when the file is absent', () => {
  const filePath = tempConfigPath();

  configService.initialize(filePath);

  assert.deepEqual(configService.listTranslations('any-guild'), []);
  assert.equal(fs.existsSync(filePath), true);
});

test('initialize loads existing translations into the cache', () => {
  const filePath = tempConfigPath();
  const data: StoreData = {
    version: 1,
    guilds: {
      g1: {
        translations: [
          {
            id: 'cfg_aaaaaa',
            sourceChannelId: 's1',
            targetChannelId: 't1',
            targetLanguage: 'ko',
            createdAt: '2026-08-07T00:00:00Z',
          },
        ],
        webhookCache: {},
      },
    },
  };
  seed(filePath, data);

  configService.initialize(filePath);

  const list = configService.listTranslations('g1');
  assert.equal(list.length, 1);
  assert.equal(list[0].sourceChannelId, 's1');
});

test('initialize normalizes a guild entry missing translations', () => {
  const filePath = tempConfigPath();
  seed(filePath, { version: 1, guilds: { g1: {} } });

  configService.initialize(filePath);

  assert.deepEqual(configService.listTranslations('g1'), []);
});

test('initialize normalizes guilds when it is not an object', () => {
  const filePath = tempConfigPath();
  seed(filePath, { version: 1, guilds: [] });

  configService.initialize(filePath);

  assert.deepEqual(configService.listTranslations('g1'), []);
});

test('listTranslations returns an empty array for an unknown guild', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);

  assert.deepEqual(configService.listTranslations('never-seen'), []);
});

test('findBySourceChannel locates a setting by its source channel', () => {
  const filePath = tempConfigPath();
  seed(filePath, {
    version: 1,
    guilds: {
      g1: {
        translations: [
          {
            id: 'cfg_aaaaaa',
            sourceChannelId: 's1',
            targetChannelId: 't1',
            targetLanguage: 'ko',
            createdAt: '2026-08-07T00:00:00Z',
          },
        ],
        webhookCache: {},
      },
    },
  });
  configService.initialize(filePath);

  assert.equal(configService.findBySourceChannel('g1', 's1')?.id, 'cfg_aaaaaa');
  assert.equal(configService.findBySourceChannel('g1', 'nope'), undefined);
  assert.equal(configService.findBySourceChannel('other-guild', 's1'), undefined);
});

test('listTranslations returns a copy that cannot mutate the cache', () => {
  const filePath = tempConfigPath();
  seed(filePath, {
    version: 1,
    guilds: {
      g1: {
        translations: [
          {
            id: 'cfg_aaaaaa',
            sourceChannelId: 's1',
            targetChannelId: 't1',
            targetLanguage: 'ko',
            createdAt: '2026-08-07T00:00:00Z',
          },
        ],
        webhookCache: {},
      },
    },
  });
  configService.initialize(filePath);

  configService.listTranslations('g1').pop();

  assert.equal(configService.listTranslations('g1').length, 1);
});
