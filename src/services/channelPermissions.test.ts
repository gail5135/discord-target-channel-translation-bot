import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import {
  missingPermissions,
  SOURCE_CHANNEL_PERMISSIONS,
  TARGET_CHANNEL_PERMISSIONS,
} from './channelPermissions';

/** 보유한 권한 비트 집합만 흉내내는 최소 권한 객체 */
function granting(flags: bigint[]) {
  return { has: (flag: bigint) => flags.includes(flag) };
}

test('missingPermissions returns an empty array when everything is granted', () => {
  const permissions = granting([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageWebhooks,
  ]);

  assert.deepEqual(missingPermissions(permissions, TARGET_CHANNEL_PERMISSIONS), []);
});

test('missingPermissions lists only the labels that are missing', () => {
  const permissions = granting([PermissionFlagsBits.ViewChannel]);

  assert.deepEqual(missingPermissions(permissions, TARGET_CHANNEL_PERMISSIONS), [
    'Send Messages',
    'Manage Webhooks',
  ]);
});

test('missingPermissions treats null as everything missing', () => {
  assert.deepEqual(missingPermissions(null, SOURCE_CHANNEL_PERMISSIONS), ['View Channel']);
  assert.deepEqual(missingPermissions(null, TARGET_CHANNEL_PERMISSIONS), [
    'View Channel',
    'Send Messages',
    'Manage Webhooks',
  ]);
});

test('source channel only requires View Channel', () => {
  assert.deepEqual(
    SOURCE_CHANNEL_PERMISSIONS.map((entry) => entry.label),
    ['View Channel']
  );
});

test('target channel requires view, send, and webhook management', () => {
  assert.deepEqual(
    TARGET_CHANNEL_PERMISSIONS.map((entry) => entry.label),
    ['View Channel', 'Send Messages', 'Manage Webhooks']
  );
});
