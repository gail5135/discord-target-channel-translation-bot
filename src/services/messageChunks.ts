/** 디스코드 메시지 본문 상한 */
export const MAX_CONTENT = 2000;

/**
 * 번역문을 2000자 이하 조각들로 나누고 접미사(원문 링크)를 마지막 조각에만 붙인다.
 *
 * 루프 조건이 `rest + suffix`가 상한을 넘는지를 보는 것이 핵심이다.
 * 본문만 기준으로 판단하면, 본문은 상한 이하인데 접미사를 더해 넘기는 구간에서
 * 마지막 조각이 상한을 초과한다.
 */
/**
 * 줄바꿈이 경계에서 너무 멀면 그냥 상한에서 자른다.
 * 이 비율보다 앞에 있는 줄바꿈을 쓰면 조각이 지나치게 짧아진다.
 */
const MIN_NEWLINE_CUT_RATIO = 0.5;

/**
 * 자를 위치를 고른다.
 *
 * 줄바꿈 경계를 우선하는 이유는 첨부 URL 때문이다 — 서명이 붙은 CDN 링크는 200자가 넘고
 * 본문 끝에 줄바꿈으로 이어 붙으므로, 글자 수로만 자르면 링크 한가운데가 갈려 죽은 링크 둘이 된다.
 * 줄바꿈이 없거나 너무 멀면 서로게이트 페어만 피해서 자른다.
 */
function safeCut(text: string, limit: number): number {
  if (text.length <= limit) return text.length;

  const newline = text.lastIndexOf('\n', limit - 1);
  if (newline >= Math.floor(limit * MIN_NEWLINE_CUT_RATIO)) {
    return newline + 1;
  }

  const code = text.charCodeAt(limit - 1);
  // 상위 서로게이트로 끝나면 짝이 다음 조각으로 넘어가 이모지가 U+FFFD 둘로 깨진다
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
