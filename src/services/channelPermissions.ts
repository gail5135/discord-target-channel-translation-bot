import { PermissionFlagsBits } from 'discord.js';

export interface PermissionEntry {
  flag: bigint;
  label: string;
}

/** `channel.permissionsFor(member)`가 돌려주는 객체의 최소 형태 */
export interface PermissionSet {
  has(flag: bigint): boolean;
}

/** 메시지 이벤트를 받으려면 채널을 볼 수 있어야 한다 (Phase 3) */
export const SOURCE_CHANNEL_PERMISSIONS: readonly PermissionEntry[] = [
  { flag: PermissionFlagsBits.ViewChannel, label: 'View Channel' },
];

/** Webhook을 만들고 번역문을 게시하려면 셋 다 필요하다 (Phase 4) */
export const TARGET_CHANNEL_PERMISSIONS: readonly PermissionEntry[] = [
  { flag: PermissionFlagsBits.ViewChannel, label: 'View Channel' },
  { flag: PermissionFlagsBits.SendMessages, label: 'Send Messages' },
  { flag: PermissionFlagsBits.ManageWebhooks, label: 'Manage Webhooks' },
];

/**
 * 봇이 채널을 볼 수 없으면 `permissionsFor`가 null을 돌려준다.
 * 그 경우 요구 권한 전부가 부족한 것으로 본다.
 */
export function missingPermissions(
  permissions: PermissionSet | null,
  required: readonly PermissionEntry[]
): string[] {
  if (!permissions) {
    return required.map((entry) => entry.label);
  }
  return required.filter((entry) => !permissions.has(entry.flag)).map((entry) => entry.label);
}
