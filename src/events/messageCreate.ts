import { ChannelType, type Message, type TextChannel } from 'discord.js';
import { findBySourceChannel } from '../services/configService';
import { AllProvidersFailedError, translate } from '../services/translationService';
import { enqueue } from '../services/messageQueue';
import { splitForDiscord } from '../services/messageChunks';

/** 장애 중 출력 채널이 실패 알림으로 도배되지 않도록 채널당 재알림 간격을 둔다 */
const FAILURE_NOTICE_COOLDOWN_MS = 10 * 60 * 1000;
const lastFailureNotice = new Map<string, number>();
const lastUnavailableLog = new Map<string, number>();

function sourceLink(message: Message): string {
  return `\nhttps://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

/** 채널이 사라졌는지는 캐시 조회로 즉시 알 수 있다. 번역 API를 쓰기 전에 먼저 확인해 쿼터 낭비를 막는다. */
function resolveOutputChannel(message: Message, targetChannelId: string): TextChannel | undefined {
  const channel = message.guild?.channels.cache.get(targetChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return undefined;
  return channel;
}

/** 채널이 사라진 상태가 지속되면 메시지마다 로그가 쌓인다. 같은 채널은 쿨다운 간격으로만 남긴다. */
function notifyChannelUnavailable(targetChannelId: string): void {
  const now = Date.now();
  if (now - (lastUnavailableLog.get(targetChannelId) ?? 0) < FAILURE_NOTICE_COOLDOWN_MS) return;
  lastUnavailableLog.set(targetChannelId, now);
  console.error(`[messageCreate] output channel ${targetChannelId} is unavailable`);
}

async function notifyFailure(channel: TextChannel): Promise<void> {
  const now = Date.now();
  if (now - (lastFailureNotice.get(channel.id) ?? 0) < FAILURE_NOTICE_COOLDOWN_MS) return;
  lastFailureNotice.set(channel.id, now);

  await channel
    .send({
      content:
        'Translation is currently failing for every configured provider. ' +
        'Messages are not being translated until this is resolved. ' +
        'Check the server logs and the API quota.',
      allowedMentions: { parse: [] },
    })
    .catch((error: unknown) => console.error('[messageCreate] failed to post failure notice', error));
}

async function postTranslation(message: Message, channel: TextChannel, body: string): Promise<void> {
  const author = message.member?.displayName ?? message.author.username;
  const chunks = splitForDiscord(`**${author}**\n${body}`, sourceLink(message));

  for (const chunk of chunks) {
    try {
      // 출력 채널은 미러이므로 멘션이 다시 울리면 안 된다. 텍스트는 그대로 렌더링된다.
      await channel.send({ content: chunk, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error('[messageCreate] failed to post translation', error);
      return;
    }
  }
}

async function translateAndPost(
  message: Message,
  targetChannelId: string,
  targetLanguage: string
): Promise<void> {
  const channel = resolveOutputChannel(message, targetChannelId);
  if (!channel) {
    notifyChannelUnavailable(targetChannelId);
    return;
  }

  let body: string;
  try {
    const result = await translate(message.content, targetLanguage);
    // 감지 언어가 타겟과 같으면 번역문 대신 원문을 쓴다 (사양서 4.1)
    body = result.detectedSourceLanguage === targetLanguage ? message.content : result.text;
  } catch (error) {
    if (error instanceof AllProvidersFailedError) {
      console.error(`[messageCreate] ${error.message}`);
      await notifyFailure(channel);
      return;
    }
    console.error('[messageCreate] unexpected translation error', error);
    return;
  }

  await postTranslation(message, channel, body);
}

export function handleMessage(message: Message): void {
  try {
    // 봇·Webhook 메시지는 무조건 제외한다 (번역 루프 방지, 사양서 4.1)
    if (message.author.bot || message.webhookId) return;
    if (!message.guildId) return;

    const setting = findBySourceChannel(message.guildId, message.channelId);
    if (!setting) return;

    // 본문이 없으면 번역할 것이 없다. 첨부만 있는 메시지는 Phase 4에서 다룬다.
    if (message.content.trim().length === 0) return;

    enqueue(message.channelId, () =>
      translateAndPost(message, setting.targetChannelId, setting.targetLanguage)
    );
  } catch (error) {
    console.error('[messageCreate] handler threw', error);
  }
}
