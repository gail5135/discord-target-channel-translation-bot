import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';

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
        option.setName('id').setDescription('ID of the setting to remove').setRequired(true)
      )
  );
