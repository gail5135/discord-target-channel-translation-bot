/**
 * key별 직렬 실행 큐. 같은 key(=채널)의 작업은 순서대로 하나씩,
 * 다른 key끼리는 병렬로 돈다.
 *
 * 병렬로 처리하면 긴 메시지(번역 느림)와 짧은 메시지(빠름)가 연달아 왔을 때
 * 번역문이 뒤바뀐 순서로 게시되어 대화를 읽을 수 없게 된다.
 */
const chains = new Map<string, Promise<void>>();

/**
 * 채널당 대기 상한. 제공자 장애로 처리가 밀리면 큐가 무한히 자라 1GB VM의 메모리를 잠식하고,
 * 한참 뒤에야 도착하는 번역문은 어차피 쓸모가 없다. 상한을 넘으면 버리고 로그를 남긴다.
 */
const MAX_QUEUE_DEPTH = 50;
const depths = new Map<string, number>();

export function enqueue(key: string, task: () => Promise<void>): void {
  const depth = depths.get(key) ?? 0;
  if (depth >= MAX_QUEUE_DEPTH) {
    console.error(`[queue] dropped task, queue full (key=${key}, depth=${depth})`);
    return;
  }
  depths.set(key, depth + 1);

  const previous = chains.get(key) ?? Promise.resolve();

  // 각 작업을 개별적으로 감싸 한 작업의 실패가 체인을 끊지 않게 한다.
  const next = previous.then(async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[queue] task failed (key=${key})`, error);
    } finally {
      const remaining = (depths.get(key) ?? 1) - 1;
      if (remaining <= 0) {
        depths.delete(key);
      } else {
        depths.set(key, remaining);
      }
    }
  });

  chains.set(key, next);

  // 체인이 비면 Map에서 지워 채널이 많은 서버에서 메모리가 늘어나지 않게 한다.
  void next.then(() => {
    if (chains.get(key) === next) {
      chains.delete(key);
    }
  });
}
