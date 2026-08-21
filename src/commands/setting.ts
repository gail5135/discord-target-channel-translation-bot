import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import {
  listTranslations,
  removeTranslation,
  upsertTranslation,
  type UpsertResult,
} from '../services/configService';
import {
  missingPermissions,
  SOURCE_CHANNEL_PERMISSIONS,
  TARGET_CHANNEL_PERMISSIONS,
} from '../services/channelPermissions';
import { invalidateWebhook } from '../services/webhookService';
import type { LanguageCode, TranslationConfig } from '../types';

export const data = new SlashCommandBuilder()
  .setName('setting')
  .setDescription('Configure translation source channel, output channel, and target language')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('register')
      .setDescription('Register a source channel, output channel, and target language as one set')
      .addChannelOption((option) =>
        option
          .setName('source-channel')
          .setDescription('Channel to monitor for new messages')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addChannelOption((option) =>
        option
          .setName('target-channel')
          .setDescription('Channel where translated messages are posted')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('target-language')
          .setDescription('Language to translate messages into')
          .setRequired(true)
          .addChoices(
            { name: '한국어', value: 'ko' },
            { name: 'English', value: 'en' },
            { name: '日本語', value: 'ja' },
            { name: '中文(简体)', value: 'zh-CN' },
            { name: 'Español', value: 'es' },
            { name: 'Français', value: 'fr' },
            { name: 'Deutsch', value: 'de' },
            { name: 'Русский', value: 'ru' },
            { name: 'Italiano', value: 'it' },
            { name: 'Bahasa Indonesia', value: 'id' }
          )
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('list').setDescription('List translation settings registered on this server')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove')
      .setDescription('Remove a registered translation setting')
      .addStringOption((option) =>
        option
          .setName('id')
          .setDescription('ID of the setting to remove')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

/** 커맨드 choices와 같은 표시명. 응답에서 코드 대신 사람이 읽는 이름을 쓴다. */
export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  'zh-CN': '中文(简体)',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
  it: 'Italiano',
  id: 'Bahasa Indonesia',
};

/** 설정 관련 응답은 전부 ephemeral이다 — 실행한 사람만 보면 된다. */
async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string
): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

const GUILD_ONLY = 'This command can only be used inside a server.';
const SAVE_FAILED = 'Failed to save the setting. Check the server logs.';

/**
 * 세 서브커맨드가 모두 같은 길드 전용 검사를 한다.
 * guildId와 guild를 함께 돌려주는 이유는 guildId만으로는 interaction.guild가
 * 좁혀지지 않아 호출부마다 두 번째 검사가 남기 때문이다.
 */
async function requireGuild(
  interaction: ChatInputCommandInteraction
): Promise<{ guildId: string; guild: Guild } | undefined> {
  if (interaction.guildId && interaction.guild) {
    return { guildId: interaction.guildId, guild: interaction.guild };
  }
  await replyEphemeral(interaction, GUILD_ONLY);
  return undefined;
}

function languageLabel(code: string): string {
  // config.json은 손으로 편집할 수 있으므로(사양서 4.2.1) 런타임 값이 LanguageCode가 아닐 수 있다.
  return Object.prototype.hasOwnProperty.call(LANGUAGE_LABELS, code)
    ? LANGUAGE_LABELS[code as LanguageCode]
    : code;
}

/**
 * 멘션 표기와 이름 표기 모두 같은 길드 캐시 조회를 쓴다. 자동완성 목록에서는 채널
 * 멘션이 렌더링되지 않아 형식만 갈리므로, 조회와 삭제된 채널 문구는 여기서만 관리한다.
 */
function lookupChannel(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  channelId: string
): { name: string } | undefined {
  return interaction.guild?.channels.cache.get(channelId);
}

function deletedChannelLabel(channelId: string): string {
  return `(deleted channel ${channelId})`;
}

/** 채널이 아직 존재하면 멘션으로, 삭제됐으면 그 사실을 드러낸다. */
function channelMention(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  channelId: string
): string {
  return lookupChannel(interaction, channelId)
    ? `<#${channelId}>`
    : deletedChannelLabel(channelId);
}

/** 자동완성 목록용. 멘션이 렌더링되지 않으므로 채널 이름을 직접 넣는다. */
function channelName(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  channelId: string
): string {
  const channel = lookupChannel(interaction, channelId);
  return channel ? `#${channel.name}` : deletedChannelLabel(channelId);
}

function describe(
  interaction: ChatInputCommandInteraction,
  setting: Readonly<TranslationConfig>
): string {
  const source = channelMention(interaction, setting.sourceChannelId);
  const target = channelMention(interaction, setting.targetChannelId);
  return `${source} → ${target} (${languageLabel(setting.targetLanguage)})`;
}

async function handleRegister(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuild(interaction);
  if (!context) return;
  const { guildId, guild } = context;

  const sourceOption = interaction.options.getChannel('source-channel', true);
  const targetOption = interaction.options.getChannel('target-channel', true);
  const targetLanguage = interaction.options.getString('target-language', true);

  if (sourceOption.id === targetOption.id) {
    await replyEphemeral(
      interaction,
      'Source and output channels are the same. Please pick two different channels.'
    );
    return;
  }

  const botMember = guild.members.me;
  if (!botMember) {
    await replyEphemeral(interaction, 'Could not read bot information. Please try again in a moment.');
    return;
  }

  // getChannel의 반환 타입은 permissionsFor가 없는 형태를 포함하므로,
  // 길드 캐시에서 실제 채널 객체를 다시 얻는다.
  const sourceChannel = guild.channels.cache.get(sourceOption.id);
  const targetChannel = guild.channels.cache.get(targetOption.id);
  if (!sourceChannel || !targetChannel) {
    await replyEphemeral(
      interaction,
      'Could not read channel information. Please try again in a moment.'
    );
    return;
  }

  const problems: string[] = [];
  const sourceMissing = missingPermissions(
    sourceChannel.permissionsFor(botMember),
    SOURCE_CHANNEL_PERMISSIONS
  );
  if (sourceMissing.length > 0) {
    problems.push(`<#${sourceChannel.id}>: ${sourceMissing.join(', ')}`);
  }
  const targetMissing = missingPermissions(
    targetChannel.permissionsFor(botMember),
    TARGET_CHANNEL_PERMISSIONS
  );
  if (targetMissing.length > 0) {
    problems.push(`<#${targetChannel.id}>: ${targetMissing.join(', ')}`);
  }

  if (problems.length > 0) {
    await replyEphemeral(
      interaction,
      [
        'Cannot register — the bot is missing permissions:',
        ...problems.map((problem) => `• ${problem}`),
        '',
        'Grant the permissions above and try again.',
      ].join('\n')
    );
    return;
  }

  let result: UpsertResult;
  try {
    result = upsertTranslation(guildId, {
      sourceChannelId: sourceChannel.id,
      targetChannelId: targetChannel.id,
      targetLanguage,
    });
  } catch (error) {
    console.error('[setting] failed to save translation config', error);
    await replyEphemeral(interaction, SAVE_FAILED);
    return;
  }

  // 출력 채널이 바뀌면 이전 채널의 Webhook은 더 쓰지 않는다. 삭제와 같은 이유로 캐시를 비운다.
  if (result.replaced && result.replaced.targetChannelId !== result.setting.targetChannelId) {
    invalidateWebhook(result.replaced.targetChannelId);
  }

  const content = result.replaced
    ? [
        `Updated the setting for <#${sourceChannel.id}>.`,
        `  Before: ${channelMention(interaction, result.replaced.targetChannelId)} (${languageLabel(result.replaced.targetLanguage)})`,
        `  After: ${channelMention(interaction, result.setting.targetChannelId)} (${languageLabel(result.setting.targetLanguage)})`,
      ].join('\n')
    : `Setting registered.\n  ${describe(interaction, result.setting)}`;

  await replyEphemeral(interaction, content);
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuild(interaction);
  if (!context) return;

  const settings = listTranslations(context.guildId);
  if (settings.length === 0) {
    await replyEphemeral(interaction, 'No settings registered yet. Use `/setting register` to add one.');
    return;
  }

  const LIST_LIMIT = 25;
  const shown = settings.slice(0, LIST_LIMIT);
  const lines = shown.map((setting) => `• ${describe(interaction, setting)}`);
  if (settings.length > shown.length) {
    lines.push(`…and ${settings.length - shown.length} more`);
  }
  await replyEphemeral(interaction, [`${settings.length} setting(s) registered:`, ...lines].join('\n'));
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuild(interaction);
  if (!context) return;

  const id = interaction.options.getString('id', true);

  let removed: Readonly<TranslationConfig> | undefined;
  try {
    removed = removeTranslation(context.guildId, id);
  } catch (error) {
    console.error('[setting] failed to save translation config', error);
    await replyEphemeral(interaction, SAVE_FAILED);
    return;
  }

  if (!removed) {
    await replyEphemeral(interaction, 'Setting not found. It may already have been removed.');
    return;
  }

  // 설정이 사라지면 그 출력 채널의 Webhook 토큰을 메모리에 들고 있을 이유가 없다.
  // 같은 채널을 쓰는 설정이 남아 있어도 안전하다 — 캐시만 비우므로 다음 메시지가 다시 확보한다.
  invalidateWebhook(removed.targetChannelId);

  await replyEphemeral(interaction, `Setting removed.\n  ${describe(interaction, removed)}`);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case 'register':
      await handleRegister(interaction);
      return;
    case 'list':
      await handleList(interaction);
      return;
    case 'remove':
      await handleRemove(interaction);
      return;
    default:
      console.error(`[setting] unknown subcommand: ${subcommand}`);
      await replyEphemeral(interaction, 'Unknown command.');
  }
}

/** 디스코드는 자동완성 선택지를 25개까지 받는다. */
const AUTOCOMPLETE_LIMIT = 25;

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.respond([]);
      return;
    }

    const focused = interaction.options.getFocused().toLowerCase();

    const choices = listTranslations(guildId)
      .map((setting) => ({
        name: `${channelName(interaction, setting.sourceChannelId)} → ${channelName(interaction, setting.targetChannelId)} (${languageLabel(setting.targetLanguage)})`.slice(
          0,
          100
        ),
        value: setting.id,
      }))
      .filter(
        (choice) =>
          focused.length === 0 ||
          choice.name.toLowerCase().includes(focused) ||
          choice.value.toLowerCase().includes(focused)
      )
      .slice(0, AUTOCOMPLETE_LIMIT);

    await interaction.respond(choices);
  } catch (error) {
    console.error('[setting] autocomplete failed', error);
    // 자동완성 실패가 커맨드 전체를 막지 않게 한다
    await interaction.respond([]).catch(() => undefined);
  }
}
