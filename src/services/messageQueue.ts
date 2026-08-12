/**
 * key별 직렬 실행 큐. 같은 key(=채널)의 작업은 순서대로 하나씩,
 * 다른 key끼리는 병렬로 돈다.
 *
 * 병렬로 처리하면 긴 메시지(번역 느림)와 짧은 메시지(빠름)가 연달아 왔을 때
 * 번역문이 뒤바뀐 순서로 게시되어 대화를 읽을 수 없게 된다.
 */
const chains = new Map<string, Promise<void>>();

export function enqueue(key: string, task: () => Promise<void>): void {
  const previous = chains.get(key) ?? Promise.resolve();

  // 각 작업을 개별적으로 감싸 한 작업의 실패가 체인을 끊지 않게 한다.
  const next = previous.then(async () => {
    try {
      await task();
    } catch (error) {
      console.error('[queue] task failed', error);
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
