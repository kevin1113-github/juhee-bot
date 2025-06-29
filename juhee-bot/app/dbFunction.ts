import { Interaction, Message } from 'discord.js';
import { Servers, Users, JoinedServer } from './dbObject.js';
import { logger } from './logger.js';

export async function RegisterUser(interaction: Interaction) {
  try {
    // Server 등록
    if (!await Servers.findOne({ where: { id: interaction.guildId } })) {
      await Servers.create({ id: interaction.guildId });
      logger.info(`✅ Server "${interaction.guild?.name}" (${interaction.guildId}) registered in database`);
    }
    // User 등록
    if (!await Users.findOne({ where: { id: interaction.user.id } })) {
      await Users.create({ id: interaction.user.id });
      logger.info(`✅ User "${interaction.user.username}" (${interaction.user.id}) registered in database`);
    }
    // JoinedServer 등록
    if (!await JoinedServer.findOne({ where: { server_id: interaction.guildId, user_id: interaction.user.id } })) {
      await JoinedServer.create({ server_id: interaction.guildId, user_id: interaction.user.id });
      logger.info(`✅ User "${interaction.user.username}" joined server "${interaction.guild?.name}"`);
    }
  } catch (error) {
    logger.error("Failed to register user from interaction:", error);
    throw error; // Re-throw to let caller handle
  }
}

export async function RegisterUserMsg(interaction: Message) {
  try {
    // Server 등록
    if (!await Servers.findOne({ where: { id: interaction.guildId } })) {
      await Servers.create({ id: interaction.guildId });
      logger.info(`✅ Server "${interaction.guild?.name}" (${interaction.guildId}) registered in database`);
    }
    // User 등록
    if (!await Users.findOne({ where: { id: interaction.author.id } })) {
      await Users.create({ id: interaction.author.id });
      logger.info(`✅ User "${interaction.author.username}" (${interaction.author.id}) registered in database`);
    }
    // JoinedServer 등록
    if (!await JoinedServer.findOne({ where: { server_id: interaction.guildId, user_id: interaction.author.id } })) {
      await JoinedServer.create({ server_id: interaction.guildId, user_id: interaction.author.id });
      logger.info(`✅ User "${interaction.author.username}" joined server "${interaction.guild?.name}"`);
    }
  } catch (error) {
    logger.error("Failed to register user from message:", error);
    throw error; // Re-throw to let caller handle
  }
}