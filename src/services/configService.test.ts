import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as configService from './configService';
import type { StoreData, TranslationConfig } from '../types';

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
      },
    },
  });
  configService.initialize(filePath);

  // listTranslations의 반환 타입은 readonly라 컴파일 타임에 .pop()이 막힌다.
  // 여기서는 타입 시스템을 우회하더라도(as) 실제로 반환된 배열이 캐시와
  // 별개의 사본이라 런타임에서도 캐시가 보호됨을 확인한다.
  (configService.listTranslations('g1') as TranslationConfig[]).pop();

  assert.equal(configService.listTranslations('g1').length, 1);
});

test('upsertTranslation adds a new setting and persists it', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);

  const result = configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  assert.equal(result.replaced, undefined);
  assert.equal(result.setting.sourceChannelId, 's1');
  assert.match(result.setting.id, /^cfg_[0-9a-z]{6}$/);
  assert.equal(configService.listTranslations('g1').length, 1);

  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.equal(onDisk.guilds.g1.translations.length, 1);
});

test('upsertTranslation replaces the setting for an already registered source channel', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);
  const first = configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  const second = configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't2',
    targetLanguage: 'ja',
  });

  assert.equal(second.replaced?.id, first.setting.id);
  assert.equal(second.replaced?.targetLanguage, 'ko');
  assert.equal(second.setting.targetLanguage, 'ja');
  assert.equal(configService.listTranslations('g1').length, 1);
});

test('upsertTranslation keeps settings of different guilds separate', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);

  configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });
  configService.upsertTranslation('g2', {
    sourceChannelId: 's1',
    targetChannelId: 't9',
    targetLanguage: 'ja',
  });

  assert.equal(configService.listTranslations('g1').length, 1);
  assert.equal(configService.listTranslations('g2').length, 1);
  assert.equal(configService.findBySourceChannel('g2', 's1')?.targetChannelId, 't9');
});

test('upsertTranslation assigns unique ids within a guild', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);

  const ids = new Set<string>();
  for (let i = 0; i < 30; i += 1) {
    ids.add(
      configService.upsertTranslation('g1', {
        sourceChannelId: `s${i}`,
        targetChannelId: 't1',
        targetLanguage: 'ko',
      }).setting.id
    );
  }

  assert.equal(ids.size, 30);
});

test('removeTranslation deletes the setting and persists the change', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);
  const created = configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  const removed = configService.removeTranslation('g1', created.setting.id);

  assert.equal(removed?.id, created.setting.id);
  assert.deepEqual(configService.listTranslations('g1'), []);

  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.deepEqual(onDisk.guilds.g1.translations, []);
});

test('removeTranslation returns undefined for an unknown id', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);

  assert.equal(configService.removeTranslation('g1', 'cfg_zzzzzz'), undefined);
});

test('settings survive a reload from disk', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);
  configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  configService.initialize(filePath);

  assert.equal(configService.listTranslations('g1').length, 1);
});

test('a failed save leaves the cache untouched', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);
  configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  // 파일이 있어야 할 자리를 디렉토리로 막아 쓰기를 실패시킨다
  fs.rmSync(filePath);
  fs.mkdirSync(filePath);

  assert.throws(() =>
    configService.upsertTranslation('g1', {
      sourceChannelId: 's2',
      targetChannelId: 't2',
      targetLanguage: 'ja',
    })
  );
  assert.equal(configService.listTranslations('g1').length, 1);
  assert.equal(configService.findBySourceChannel('g1', 's2'), undefined);
});

test('returned settings are typed readonly so callers cannot corrupt the cache', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);
  const created = configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  // @ts-expect-error — setting is Readonly<TranslationConfig>
  created.setting.targetLanguage = 'ja';

  // 런타임에는 대입이 통과하지만, 위 @ts-expect-error가 컴파일 단계에서
  // 이 대입이 실제로 금지되어 있음을 보증한다. 지시어가 불필요해지면
  // (즉 readonly가 풀리면) typecheck가 실패한다.
  assert.equal(configService.findBySourceChannel('g1', 's1')?.targetLanguage, 'ja');
});

test('listTranslations elements are typed readonly', () => {
  const filePath = tempConfigPath();
  configService.initialize(filePath);
  configService.upsertTranslation('g1', {
    sourceChannelId: 's1',
    targetChannelId: 't1',
    targetLanguage: 'ko',
  });

  const settings = configService.listTranslations('g1');

  // @ts-expect-error — elements are Readonly<TranslationConfig>
  settings[0].targetLanguage = 'ja';

  assert.equal(settings.length, 1);
});
