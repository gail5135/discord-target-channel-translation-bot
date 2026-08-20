export interface WebhookSendOptions {
  content: string;
  username: string;
  avatarURL?: string;
  allowedMentions: { parse: [] };
}

export interface WebhookLike {
  id: string;
  owner: { id: string } | null;
  send(options: WebhookSendOptions): Promise<unknown>;
}

/**
 * discord.js TextChannel이 만족하는 최소 형태.
 * 전체 타입을 요구하면 테스트가 무거운 목을 만들어야 한다.
 */
export interface WebhookHost {
  id: string;
  fetchWebhooks(): Promise<{ find(fn: (w: WebhookLike) => boolean): WebhookLike | undefined }>;
  createWebhook(options: { name: string }): Promise<WebhookLike>;
}

/** 생성 시 붙는 이름. 전송할 때마다 username으로 덮어쓰므로 표시에는 거의 쓰이지 않는다. */
const WEBHOOK_NAME = 'Translation Bot';

/**
 * REST 오류 객체를 그대로 로그에 넘기면 안 된다 — @discordjs/rest가 요청 URL을
 * 통째로 담아두는데, Webhook 요청 URL에는 토큰이 들어 있다(설계서 2.1).
 * 식별에 필요한 것만 뽑아 쓴다.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return code === undefined ? error.message : `${error.message} (code ${String(code)})`;
  }
  return String(error);
}

/**
 * 채널별 Webhook 캐시. 해결된 값이 아니라 **진행 중인 Promise**를 담는다 —
 * 같은 출력 채널을 쓰는 원본 채널이 둘이면(사양서 4.1의 N:1) 큐가 원본 기준으로만
 * 직렬화하므로 두 호출이 동시에 캐시를 비켜 갈 수 있고, 그러면 Webhook이 두 개 생긴다.
 *
 * 디스크에 저장하지 않는 이유는 설계서 2.1 참고 — 토큰은 만료 없는 자격증명이다.
 */
const cache = new Map<string, Promise<WebhookLike | undefined>>();

async function acquire(channel: WebhookHost, botUserId: string): Promise<WebhookLike> {
  const webhooks = await channel.fetchWebhooks();
  // 남이 만든 Webhook을 빌려 쓰면 그 소유자가 지웠을 때 조용히 깨진다. 봇 소유만 쓴다.
  const own = webhooks.find((w) => w.owner?.id === botUserId);
  return own ?? (await channel.createWebhook({ name: WEBHOOK_NAME }));
}

export function getWebhook(
  channel: WebhookHost,
  botUserId: string
): Promise<WebhookLike | undefined> {
  const cached = cache.get(channel.id);
  if (cached) return cached;

  const pending = acquire(channel, botUserId).catch((error: unknown) => {
    console.error(
      `[webhook] could not obtain a webhook for channel ${channel.id}: ${describeError(error)}`
    );
    return undefined;
  });

  cache.set(channel.id, pending);

  // 실패는 캐시하지 않는다. 다만 그 사이 더 새로운 호출이 항목을 갈아끼웠다면 그쪽은 건드리면 안 된다.
  void pending.then((webhook) => {
    if (webhook === undefined && cache.get(channel.id) === pending) {
      cache.delete(channel.id);
    }
  });

  return pending;
}

/**
 * 전송이 실패하면 호출한다. 관리자가 Webhook을 삭제한 경우가 대표적이며,
 * 캐시만 비우면 다음 메시지가 자연히 재생성한다. 재시도 경로를 따로 두지 않는다.
 */
export function invalidateWebhook(channelId: string): void {
  cache.delete(channelId);
}

/** 모듈 수준 캐시가 테스트 사이에 새지 않도록 비운다. 운영 코드는 호출하지 않는다. */
export function resetWebhookCacheForTests(): void {
  cache.clear();
}
