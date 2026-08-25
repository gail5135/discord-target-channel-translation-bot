import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { data as settingCommand } from './commands/setting';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error(
    'DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID must all be set in .env'
  );
}

const rest = new REST({ version: '10' }).setToken(token);

async function main(): Promise<void> {
  const commands = [settingCommand.toJSON()];
  await rest.put(Routes.applicationGuildCommands(clientId as string, guildId as string), {
    body: commands,
  });
  console.log(`Registered ${commands.length} command(s) to guild ${guildId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
