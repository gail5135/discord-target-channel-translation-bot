import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureNoticeContent } from './messageCreate';

const LINK = 'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333';

test('the failure notice carries the link to the message that failed', () => {
  const content = failureNoticeContent(LINK);

  assert.ok(content.includes(LINK), `notice did not contain the link: ${content}`);
});

test('the link sits on its own line so it stays clickable next to the prose', () => {
  const content = failureNoticeContent(LINK);

  const lines = content.split('\n');
  assert.ok(lines.includes(LINK), `link was not on a line of its own: ${content}`);
});
