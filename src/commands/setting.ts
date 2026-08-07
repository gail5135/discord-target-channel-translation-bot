import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
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
import type { TranslationConfig } from '../types';

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
export const LANGUAGE_LABELS: Record<string, string> = {
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

function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code;
}

/** 채널이 아직 존재하면 멘션으로, 삭제됐으면 그 사실을 드러낸다. */
function channelLabel(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  channelId: string
): string {
  const channel = interaction.guild?.channels.cache.get(channelId);
  return channel ? `<#${channelId}>` : `(deleted channel ${channelId})`;
}

function describe(
  interaction: ChatInputCommandInteraction,
  setting: Readonly<TranslationConfig>
): string {
  const source = channelLabel(interaction, setting.sourceChannelId);
  const target = channelLabel(interaction, setting.targetChannelId);
  return `${source} → ${target} (${languageLabel(setting.targetLanguage)})`;
}

async function handleRegister(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sourceOption = interaction.options.getChannel('source-channel', true);
  const targetOption = interaction.options.getChannel('target-channel', true);
  const targetLanguage = interaction.options.getString('target-language', true);

  if (sourceOption.id === targetOption.id) {
    await interaction.reply({
      content: 'Source and output channels are the same. Please pick two different channels.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = interaction.guild.members.me;
  if (!botMember) {
    await interaction.reply({
      content: 'Could not read bot information. Please try again in a moment.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // getChannel의 반환 타입은 permissionsFor가 없는 형태를 포함하므로,
  // 길드 캐시에서 실제 채널 객체를 다시 얻는다.
  const sourceChannel = interaction.guild.channels.cache.get(sourceOption.id);
  const targetChannel = interaction.guild.channels.cache.get(targetOption.id);
  if (!sourceChannel || !targetChannel) {
    await interaction.reply({
      content: 'Could not read channel information. Please try again in a moment.',
      flags: MessageFlags.Ephemeral,
    });
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
    await interaction.reply({
      content: [
        'Cannot register — the bot is missing permissions:',
        ...problems.map((problem) => `• ${problem}`),
        '',
        'Grant the permissions above and try again.',
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
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
    await interaction.reply({
      content: 'Failed to save the setting. Check the server logs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const content = result.replaced
    ? [
        `Updated the setting for <#${sourceChannel.id}>.`,
        `  Before: ${channelLabel(interaction, result.replaced.targetChannelId)} (${languageLabel(result.replaced.targetLanguage)})`,
        `  After: ${channelLabel(interaction, result.setting.targetChannelId)} (${languageLabel(result.setting.targetLanguage)})`,
      ].join('\n')
    : `Setting registered.\n  ${describe(interaction, result.setting)}`;

  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settings = listTranslations(guildId);
  if (settings.length === 0) {
    await interaction.reply({
      content: 'No settings registered yet. Use `/setting register` to add one.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const LIST_LIMIT = 25;
  const shown = settings.slice(0, LIST_LIMIT);
  const lines = shown.map((setting) => `• ${describe(interaction, setting)}`);
  if (settings.length > shown.length) {
    lines.push(`…and ${settings.length - shown.length} more`);
  }
  await interaction.reply({
    content: [`${settings.length} setting(s) registered:`, ...lines].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used inside a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const id = interaction.options.getString('id', true);

  let removed: Readonly<TranslationConfig> | undefined;
  try {
    removed = removeTranslation(guildId, id);
  } catch (error) {
    console.error('[setting] failed to save translation config', error);
    await interaction.reply({
      content: 'Failed to save the setting. Check the server logs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!removed) {
    await interaction.reply({
      content: 'Setting not found. It may already have been removed.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `Setting removed.\n  ${describe(interaction, removed)}`,
    flags: MessageFlags.Ephemeral,
  });
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
      await interaction.reply({
        content: 'Unknown command.',
        flags: MessageFlags.Ephemeral,
      });
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

    // 자동완성 목록에서는 채널 멘션이 렌더링되지 않으므로 채널 이름을 직접 넣는다.
    const nameOf = (channelId: string): string => {
      const channel = interaction.guild?.channels.cache.get(channelId);
      return channel ? `#${channel.name}` : `(deleted ${channelId})`;
    };

    const focused = interaction.options.getFocused().toLowerCase();

    const choices = listTranslations(guildId)
      .map((setting) => ({
        name: `${nameOf(setting.sourceChannelId)} → ${nameOf(setting.targetChannelId)} (${languageLabel(setting.targetLanguage)})`.slice(
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
