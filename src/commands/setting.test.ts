import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { data, LANGUAGE_LABELS } from './setting';
import type { LanguageCode } from '../types';

test('setting command is named "setting"', () => {
  const json = data.toJSON();
  assert.equal(json.name, 'setting');
});

test('setting command defaults to Manage Server permission', () => {
  const json = data.toJSON();
  assert.equal(json.default_member_permissions, String(PermissionFlagsBits.ManageGuild));
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

test('channel options are restricted to text channels and required', () => {
  const json = data.toJSON();
  const register = (json.options ?? []).find((option) => option.name === 'register') as {
    options?: { name: string; required?: boolean; channel_types?: number[] }[];
  };
  for (const name of ['source-channel', 'target-channel']) {
    const option = (register.options ?? []).find((o) => o.name === name);
    assert.deepEqual(option?.channel_types, [ChannelType.GuildText], `${name} channel_types`);
    assert.equal(option?.required, true, `${name} required`);
  }
});

test('target-language offers a fixed set of choices', () => {
  const json = data.toJSON();
  const register = (json.options ?? []).find((option) => option.name === 'register') as {
    options?: { name: string; choices?: { value: string }[] }[];
  };
  const language = (register.options ?? []).find((o) => o.name === 'target-language');
  const values = (language?.choices ?? []).map((choice) => choice.value);
  assert.deepEqual(values, ['ko', 'en', 'ja', 'zh-CN', 'es', 'fr', 'de', 'ru', 'it', 'id']);
});

test('every target-language choice has a display label', () => {
  const json = data.toJSON();
  const register = (json.options ?? []).find((option) => option.name === 'register') as {
    options?: { name: string; choices?: { name: string; value: string }[] }[];
  };
  const choices = (register.options ?? []).find((o) => o.name === 'target-language')?.choices ?? [];

  assert.equal(choices.length, Object.keys(LANGUAGE_LABELS).length);
  for (const choice of choices) {
    assert.equal(LANGUAGE_LABELS[choice.value as LanguageCode], choice.name, `label for ${choice.value}`);
  }
});
