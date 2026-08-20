/** 디스코드 메시지 본문 상한 */
export const MAX_CONTENT = 2000;

/**
 * 번역문을 2000자 이하 조각들로 나누고 접미사(원문 링크)를 마지막 조각에만 붙인다.
 *
 * 루프 조건이 `rest + suffix`가 상한을 넘는지를 보는 것이 핵심이다.
 * 본문만 기준으로 판단하면, 본문은 상한 이하인데 접미사를 더해 넘기는 구간에서
 * 마지막 조각이 상한을 초과한다.
 */
/** 서로게이트 페어 중간에서 자르면 이모지가 U+FFFD 두 개로 깨진다. 그런 경우 한 글자 앞에서 자른다. */
function safeCut(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const code = text.charCodeAt(limit - 1);
  // 상위 서로게이트로 끝나면 짝이 다음 조각으로 넘어가버린다
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}

export function splitForDiscord(text: string, suffix: string): string[] {
  const chunks: string[] = [];
  let rest = text;

  while (rest.length + suffix.length > MAX_CONTENT) {
    const cut = safeCut(rest, MAX_CONTENT);
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }

  chunks.push(rest + suffix);
  return chunks;
}
