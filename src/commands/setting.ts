import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('setting')
  .setDescription('번역 모니터링 채널·출력 채널·타겟 언어를 설정합니다')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
          .setDescription('번역 결과로 출력할 타겟 언어')
          .setRequired(true)
          .addChoices(
            { name: '한국어', value: 'ko' },
            { name: '영어', value: 'en' },
            { name: '일본어', value: 'ja' },
            { name: '중국어(간체)', value: 'zh-CN' },
            { name: '스페인어', value: 'es' },
            { name: '프랑스어', value: 'fr' },
            { name: '독일어', value: 'de' },
            { name: '러시아어', value: 'ru' },
            { name: '이탈리아어', value: 'it' },
            { name: '인도네시아어', value: 'id' }
          )
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
