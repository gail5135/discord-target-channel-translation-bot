/** Discord Webhook username 상한 */
const MAX_USERNAME = 80;

/** Discord가 Webhook username에 허용하지 않는 부분 문자열 */
const FORBIDDEN_SUBSTRINGS = /discord|clyde/gi;

/** Discord가 Webhook username으로 허용하지 않는 예약어 */
const RESERVED = new Set(['everyone', 'here']);

/** 제약에 맞게 다듬는다. 사용할 수 없는 이름이면 빈 문자열을 돌려준다. */
function clean(name: string): string {
  const stripped = name.replace(FORBIDDEN_SUBSTRINGS, '').trim();
  if (stripped.length === 0) return '';
  if (RESERVED.has(stripped.toLowerCase())) return '';
  return stripped.slice(0, MAX_USERNAME);
}

/**
 * 서버 별명을 우선 쓰되 Webhook username 제약에 맞게 정제한다.
 * 별명이 쓸 수 없으면 계정명, 그것도 안 되면 'Unknown'으로 떨어진다.
 * 제약을 어기면 전송이 400으로 실패하는데, 사용자가 정한 별명은 봇이 통제할 수 없다.
 */
export function sanitizeWebhookUsername(preferred: string, fallback: string): string {
  return clean(preferred) || clean(fallback) || 'Unknown';
}
