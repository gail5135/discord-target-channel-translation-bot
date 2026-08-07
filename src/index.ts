import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initialize as initializeConfig } from './services/configService';
import { handleInteraction } from './events/interactionCreate';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN must be set in .env');
}

// 설정을 읽지 못한 채 봇이 떠 있는 것보다 기동 실패가 낫다
initializeConfig();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, handleInteraction);

client.login(token);
