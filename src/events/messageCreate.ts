import { ChannelType, type Message } from 'discord.js';
import { findBySourceChannel } from '../services/configService';
import { AllProvidersFailedError, translate } from '../services/translationService';
import { enqueue } from '../services/messageQueue';
import { splitForDiscord } from '../services/messageChunks';

/** 장애 중 출력 채널이 실패 알림으로 도배되지 않도록 채널당 재알림 간격을 둔다 */
const FAILURE_NOTICE_COOLDOWN_MS = 10 * 60 * 1000;
const lastFailureNotice = new Map<string, number>();

function sourceLink(message: Message): string {
  return `\nhttps://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

async function notifyFailure(message: Message, targetChannelId: string): Promise<void> {
  const now = Date.now();
  const previous = lastFailureNotice.get(targetChannelId) ?? 0;
  if (now - previous < FAILURE_NOTICE_COOLDOWN_MS) return;
  lastFailureNotice.set(targetChannelId, now);

  const channel = message.guild?.channels.cache.get(targetChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  await channel
    .send(
      'Translation is currently failing for every configured provider. ' +
        'Messages are not being translated until this is resolved. ' +
        'Check the server logs and the API quota.'
    )
    .catch((error: unknown) => console.error('[messageCreate] failed to post failure notice', error));
}

async function process(message: Message, targetChannelId: string, targetLanguage: string): Promise<void> {
  let body: string;
  try {
    const result = await translate(message.content, targetLanguage);
    // 감지 언어가 타겟과 같으면 번역문 대신 원문을 쓴다 (사양서 4.1)
    body = result.detectedSourceLanguage === targetLanguage ? message.content : result.text;
  } catch (error) {
    if (error instanceof AllProvidersFailedError) {
      console.error(`[messageCreate] ${error.message}`);
      await notifyFailure(message, targetChannelId);
      return;
    }
    console.error('[messageCreate] unexpected translation error', error);
    return;
  }

  const channel = message.guild?.channels.cache.get(targetChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error(`[messageCreate] output channel ${targetChannelId} is unavailable`);
    return;
  }

  const author = message.member?.displayName ?? message.author.username;
  const chunks = splitForDiscord(`**${author}**\n${body}`, sourceLink(message));

  for (const chunk of chunks) {
    try {
      await channel.send(chunk);
    } catch (error) {
      console.error('[messageCreate] failed to post translation', error);
      return;
    }
  }
}

export function handleMessage(message: Message): void {
  // 봇·Webhook 메시지는 무조건 제외한다 (번역 루프 방지, 사양서 4.1)
  if (message.author.bot || message.webhookId) return;
  if (!message.guildId) return;

  const setting = findBySourceChannel(message.guildId, message.channelId);
  if (!setting) return;

  // 본문이 없으면 번역할 것이 없다. 첨부만 있는 메시지는 Phase 4에서 다룬다.
  if (message.content.trim().length === 0) return;

  enqueue(message.channelId, () =>
    process(message, setting.targetChannelId, setting.targetLanguage)
  );
}
