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
  return channel ? `<#${channelId}>` : `(삭제된 채널 ${channelId})`;
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
      content: '이 명령어는 서버 안에서만 사용할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sourceOption = interaction.options.getChannel('source-channel', true);
  const targetOption = interaction.options.getChannel('target-channel', true);
  const targetLanguage = interaction.options.getString('target-language', true);

  if (sourceOption.id === targetOption.id) {
    await interaction.reply({
      content: '원본 채널과 출력 채널이 같습니다. 서로 다른 채널을 지정해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = interaction.guild.members.me;
  if (!botMember) {
    await interaction.reply({
      content: '봇 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
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
      content: '채널 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
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
        '봇에게 필요한 권한이 없어 등록하지 못했습니다.',
        ...problems.map((problem) => `• ${problem}`),
        '',
        '채널 권한을 부여한 뒤 다시 시도해주세요.',
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
      content: '설정을 저장하지 못했습니다. 서버 로그를 확인해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const content = result.replaced
    ? [
        `<#${sourceChannel.id}>의 설정을 변경했습니다.`,
        `  이전: ${channelLabel(interaction, result.replaced.targetChannelId)} (${languageLabel(result.replaced.targetLanguage)})`,
        `  변경: ${channelLabel(interaction, result.setting.targetChannelId)} (${languageLabel(result.setting.targetLanguage)})`,
      ].join('\n')
    : `설정을 등록했습니다.\n  ${describe(interaction, result.setting)}`;

  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: '이 명령어는 서버 안에서만 사용할 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settings = listTranslations(guildId);
  if (settings.length === 0) {
    await interaction.reply({
      content: '등록된 설정이 없습니다. `/setting register`로 등록해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = settings.map((setting) => `• ${describe(interaction, setting)}`);
  await interaction.reply({
    content: [`등록된 설정 ${settings.length}개:`, ...lines].join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: '이 명령어는 서버 안에서만 사용할 수 있습니다.',
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
      content: '설정을 저장하지 못했습니다. 서버 로그를 확인해주세요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!removed) {
    await interaction.reply({
      content: '해당 설정을 찾지 못했습니다. 이미 삭제되었을 수 있습니다.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `설정을 삭제했습니다.\n  ${describe(interaction, removed)}`,
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
        content: '알 수 없는 명령입니다.',
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
      return channel ? `#${channel.name}` : `(삭제됨 ${channelId})`;
    };

    const choices = listTranslations(guildId)
      .slice(0, AUTOCOMPLETE_LIMIT)
      .map((setting) => ({
        name: `${nameOf(setting.sourceChannelId)} → ${nameOf(setting.targetChannelId)} (${languageLabel(setting.targetLanguage)})`.slice(
          0,
          100
        ),
        value: setting.id,
      }));

    await interaction.respond(choices);
  } catch (error) {
    console.error('[setting] autocomplete failed', error);
    // 자동완성 실패가 커맨드 전체를 막지 않게 한다
    await interaction.respond([]).catch(() => undefined);
  }
}
