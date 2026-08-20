import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initialize as initializeConfig } from './services/configService';
import { initializeTranslator } from './services/translationService';
import { handleInteraction } from './events/interactionCreate';
import { handleMessage } from './events/messageCreate';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN must be set in .env');
}

// 설정을 읽지 못한 채 봇이 떠 있는 것보다 기동 실패가 낫다
initializeConfig();
// 번역할 수 없는 상태로 떠 있으면 모든 메시지가 실패 알림만 유발한다
initializeTranslator();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Developer Portal에서 MESSAGE CONTENT INTENT를 켜야 실제로 내용이 들어온다
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.MessageCreate, handleMessage);

client.login(token);
