import { MessageFlags, type Interaction } from 'discord.js';
import { autocomplete as settingAutocomplete, data as settingData, execute as settingExecute } from '../commands/setting';

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === settingData.name) {
      await settingAutocomplete(interaction);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== settingData.name) return;

  try {
    await settingExecute(interaction);
  } catch (error) {
    console.error('[interactionCreate] command handler threw', error);
    const message = {
      content: 'Something went wrong while handling the command.',
      flags: MessageFlags.Ephemeral as const,
    };
    // 이미 응답했다면 followUp을, 아니라면 reply를 써야 한다
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message).catch(() => undefined);
    } else {
      await interaction.reply(message).catch(() => undefined);
    }
  }
}
