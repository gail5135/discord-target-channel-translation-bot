/**
 * 같은 키로 반복 발생하는 알림·로그의 간격을 제한한다.
 *
 * 간격이 지난 항목은 판정에 영향을 주지 않으므로, 발동할 때마다 쓸어낸다.
 * 그러지 않으면 실패를 한 번이라도 겪은 채널 수만큼 맵이 영구히 자란다 —
 * 24시간 도는 프로세스에서만 드러나는 문제다.
 */
export interface Cooldown {
  /** 간격이 지났으면 타이머를 다시 시작하고 true. 아직이면 false. */
  claim(key: string): boolean;
  /** 보관 중인 키 수. 맵이 무한히 자라지 않는지 테스트에서 확인하려고 노출한다. */
  size(): number;
}

/** `now`는 테스트에서 수동 시계를 주입하려고 받는다. 운영 코드는 기본값을 쓴다. */
export function createCooldown(intervalMs: number, now: () => number = Date.now): Cooldown {
  const lastFired = new Map<string, number>();

  return {
    claim(key: string): boolean {
      const at = now();
      const previous = lastFired.get(key);
      if (previous !== undefined && at - previous < intervalMs) return false;

      // 발동할 때만 쓸어낸다. 키당 간격에 한 번씩이므로 순회 비용이 문제 되지 않는다.
      for (const [existing, firedAt] of lastFired) {
        if (at - firedAt >= intervalMs) lastFired.delete(existing);
      }

      lastFired.set(key, at);
      return true;
    },
    size: () => lastFired.size,
  };
}
