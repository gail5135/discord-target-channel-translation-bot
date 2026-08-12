/** 디스코드 메시지 본문 상한 */
export const MAX_CONTENT = 2000;

/**
 * 번역문을 2000자 이하 조각들로 나누고 접미사(원문 링크)를 마지막 조각에만 붙인다.
 *
 * 루프 조건이 `rest + suffix`가 상한을 넘는지를 보는 것이 핵심이다.
 * 본문만 기준으로 판단하면, 본문은 상한 이하인데 접미사를 더해 넘기는 구간에서
 * 마지막 조각이 상한을 초과한다.
 */
export function splitForDiscord(text: string, suffix: string): string[] {
  const chunks: string[] = [];
  let rest = text;

  while (rest.length + suffix.length > MAX_CONTENT) {
    chunks.push(rest.slice(0, MAX_CONTENT));
    rest = rest.slice(MAX_CONTENT);
  }

  chunks.push(rest + suffix);
  return chunks;
}
