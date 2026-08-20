import { ChannelType, type Message, type TextChannel } from 'discord.js';
import { findBySourceChannel } from '../services/configService';
import { AllProvidersFailedError, translate } from '../services/translationService';
import { enqueue } from '../services/messageQueue';
import { splitForDiscord } from '../services/messageChunks';
import { sanitizeWebhookUsername } from '../services/webhookIdentity';
import { getWebhook, invalidateWebhook, type WebhookHost } from '../services/webhookService';

/** 장애 중 출력 채널이 실패 알림으로 도배되지 않도록 채널당 재알림 간격을 둔다 */
const FAILURE_NOTICE_COOLDOWN_MS = 10 * 60 * 1000;
const lastFailureNotice = new Map<string, number>();
const lastUnavailableLog = new Map<string, number>();

function sourceLink(message: Message): string {
  return `\nhttps://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

/**
 * 첨부는 URL만 덧붙인다. 내려받아 재업로드하면 파일 크기만큼 egress를 쓰는데
 * e2-micro는 월 1GB뿐이다(설계서 2.4). 대신 CDN 서명 만료로 나중에 깨질 수 있다.
 */
function attachmentLinks(message: Message): string {
  const urls = [...message.attachments.values()].map((attachment) => attachment.url);
  return urls.length > 0 ? `\n${urls.join('\n')}` : '';
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

/** Webhook을 못 얻었을 때의 폴백. 이름이 헤더로 못 올라가므로 본문 첫 줄에 굵게 넣는다. */
async function postAsBot(channel: TextChannel, author: string, body: string, link: string): Promise<void> {
  for (const chunk of splitForDiscord(`**${author}**\n${body}`, link)) {
    try {
      await channel.send({ content: chunk, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error('[messageCreate] failed to post translation', error);
      return;
    }
  }
}

async function postTranslation(message: Message, channel: TextChannel, body: string): Promise<void> {
  const author = sanitizeWebhookUsername(
    message.member?.displayName ?? '',
    message.author.username
  );
  const link = sourceLink(message);
  const botUserId = message.client.user?.id;

  const webhook = botUserId
    ? await getWebhook(channel as unknown as WebhookHost, botUserId)
    : undefined;

  if (!webhook) {
    // 미러가 조용히 멈추는 것보다 이름이 덜 정확하더라도 계속 도는 편이 낫다 (설계서 2.7)
    console.error(`[messageCreate] posting as bot; no webhook for channel ${channel.id}`);
    await postAsBot(channel, author, body, link);
    return;
  }

  const avatarURL = message.author.displayAvatarURL();

  for (const chunk of splitForDiscord(body, link)) {
    try {
      await webhook.send({
        content: chunk,
        username: author,
        avatarURL,
        // 출력 채널은 미러이므로 멘션이 다시 울리면 안 된다 (Phase 3에서 확립)
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('[messageCreate] webhook send failed', error);
      // 관리자가 Webhook을 지운 경우가 대표적이다. 캐시만 비우면 다음 메시지가 재생성한다.
      invalidateWebhook(channel.id);
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

  const text = message.content.trim();
  const links = attachmentLinks(message);

  // 본문이 없으면 번역할 것이 없다. 첨부만 전달하며 번역 API도 부르지 않는다 (설계서 2.5)
  if (text.length === 0) {
    await postTranslation(message, channel, links.trimStart());
    return;
  }

  let translated: string;
  try {
    const result = await translate(message.content, targetLanguage);
    // 감지 언어가 타겟과 같으면 번역문 대신 원문을 쓴다 (사양서 4.1)
    translated = result.detectedSourceLanguage === targetLanguage ? message.content : result.text;
  } catch (error) {
    if (error instanceof AllProvidersFailedError) {
      console.error(`[messageCreate] ${error.message}`);
      await notifyFailure(channel);
      return;
    }
    console.error('[messageCreate] unexpected translation error', error);
    return;
  }

  await postTranslation(message, channel, translated + links);
}

export function handleMessage(message: Message): void {
  try {
    // 봇·Webhook 메시지는 무조건 제외한다 (번역 루프 방지, 사양서 4.1)
    if (message.author.bot || message.webhookId) return;
    if (!message.guildId) return;

    const setting = findBySourceChannel(message.guildId, message.channelId);
    if (!setting) return;

    // 본문도 첨부도 없으면 전달할 것이 없다. 첨부만 있는 메시지는 번역 없이 전달한다 (설계서 2.5)
    if (message.content.trim().length === 0 && message.attachments.size === 0) return;

    enqueue(message.channelId, () =>
      translateAndPost(message, setting.targetChannelId, setting.targetLanguage)
    );
  } catch (error) {
    console.error('[messageCreate] handler threw', error);
  }
}
