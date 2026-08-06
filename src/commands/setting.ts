import { SlashCommandBuilder, ChannelType } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('setting')
  .setDescription('번역 모니터링 채널·출력 채널·타겟 언어를 설정합니다')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('register')
      .setDescription('모니터링 채널·출력 채널·타겟 언어를 세트로 등록합니다')
      .addChannelOption((option) =>
        option
          .setName('source-channel')
          .setDescription('모니터링할 원본 채널')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addChannelOption((option) =>
        option
          .setName('target-channel')
          .setDescription('번역 결과를 게시할 출력 채널')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('target-language')
          .setDescription('타겟 언어 (ISO 639-1 코드, 예: ko, en, ja)')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(5)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName('list').setDescription('현재 서버에 등록된 설정 목록을 확인합니다')
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove')
      .setDescription('등록된 설정 세트를 삭제합니다')
      .addStringOption((option) =>
        option.setName('id').setDescription('삭제할 설정의 ID').setRequired(true)
      )
  );
