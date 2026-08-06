import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data } from './setting';

test('setting command is named "setting"', () => {
  const json = data.toJSON();
  assert.equal(json.name, 'setting');
});

test('setting command has register, list, remove subcommands', () => {
  const json = data.toJSON();
  const names = (json.options ?? []).map((option) => option.name).sort();
  assert.deepEqual(names, ['list', 'register', 'remove']);
});

test('register subcommand has source-channel, target-channel, target-language options', () => {
  const json = data.toJSON();
  const register = (json.options ?? []).find((option) => option.name === 'register') as {
    options?: { name: string }[];
  };
  const optionNames = (register.options ?? []).map((option) => option.name).sort();
  assert.deepEqual(optionNames, ['source-channel', 'target-channel', 'target-language']);
});

test('remove subcommand has an id option', () => {
  const json = data.toJSON();
  const remove = (json.options ?? []).find((option) => option.name === 'remove') as {
    options?: { name: string }[];
  };
  assert.equal(remove.options?.[0]?.name, 'id');
});
