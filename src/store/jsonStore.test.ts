import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStore, saveStore } from './jsonStore';
import type { StoreData } from '../types';

function tempFilePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-test-'));
  return path.join(dir, 'config.json');
}

test('loadStore creates a default structure when the file does not exist', () => {
  const filePath = tempFilePath();

  const data = loadStore(filePath);

  assert.deepEqual(data, { version: 1, guilds: {} });
  assert.equal(fs.existsSync(filePath), true);
});

test('loadStore returns existing valid data unchanged', () => {
  const filePath = tempFilePath();
  const seed: StoreData = {
    version: 1,
    guilds: { '123': { translations: [] } },
  };
  fs.writeFileSync(filePath, JSON.stringify(seed));

  const data = loadStore(filePath);

  assert.deepEqual(data, seed);
});

test('loadStore falls back to the .bak file when the main file is corrupted', () => {
  const filePath = tempFilePath();
  const backup: StoreData = {
    version: 1,
    guilds: { '456': { translations: [] } },
  };
  fs.writeFileSync(`${filePath}.bak`, JSON.stringify(backup));
  fs.writeFileSync(filePath, '{ not valid json');

  const data = loadStore(filePath);

  assert.deepEqual(data, backup);
});

test('loadStore throws when both the main file and the backup are invalid', () => {
  const filePath = tempFilePath();
  fs.writeFileSync(filePath, '{ not valid json');
  fs.writeFileSync(`${filePath}.bak`, '{ also not valid json');

  assert.throws(() => loadStore(filePath));
});

test('loadStore recovers from .bak when the main file is missing, and preserves it', () => {
  const filePath = tempFilePath();
  const backup: StoreData = {
    version: 1,
    guilds: { '321': { translations: [] } },
  };
  fs.writeFileSync(`${filePath}.bak`, JSON.stringify(backup));

  const data = loadStore(filePath);

  assert.deepEqual(data, backup);
  // main is repaired on disk, so a later save cannot clobber the backup
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf-8')), backup);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf-8')), backup);
});

test('a save after recovery does not destroy the backup', () => {
  const filePath = tempFilePath();
  const good: StoreData = {
    version: 1,
    guilds: { '654': { translations: [] } },
  };
  fs.writeFileSync(`${filePath}.bak`, JSON.stringify(good));
  fs.writeFileSync(filePath, '{ corrupted');

  const recovered = loadStore(filePath);
  saveStore(filePath, recovered);

  const backupOnDisk = JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf-8'));
  assert.deepEqual(backupOnDisk, good);
});

test('saveStore writes the new data and backs up the previous version', () => {
  const filePath = tempFilePath();
  const first: StoreData = { version: 1, guilds: {} };
  saveStore(filePath, first);

  const second: StoreData = {
    version: 1,
    guilds: { '789': { translations: [] } },
  };
  saveStore(filePath, second);

  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.deepEqual(onDisk, second);
  const backup = JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf-8'));
  assert.deepEqual(backup, first);
});

test('saveStore creates the parent directory if it does not exist yet', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonstore-test-'));
  const filePath = path.join(base, 'nested', 'config.json');

  saveStore(filePath, { version: 1, guilds: {} });

  assert.equal(fs.existsSync(filePath), true);
});
