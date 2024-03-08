import { Interaction, Message } from 'discord.js';
import { Servers, Users, JoinedServer } from './dbObject.js';

export async function RegisterUser(interaction: Interaction) {
  // Server 등록
  if (!await Servers.findOne({ where: { id: interaction.guildId } })) {
    await Servers.create({ id: interaction.guildId });
    console.log(`${interaction.guild?.name} 서버가 데이터베이스에 등록되었습니다.`);
  }
  // User 등록
  if (!await Users.findOne({ where: { id: interaction.user.id } })) {
    await Users.create({ id: interaction.user.id });
    console.log(`${interaction.user.username}님께서 데이터베이스에 등록되었습니다.`);
  }
  // JoinedServer 등록
  if (!await JoinedServer.findOne({ where: { server_id: interaction.guildId, user_id: interaction.user.id } })) {
    await JoinedServer.create({ server_id: interaction.guildId, user_id: interaction.user.id });
    console.log(`${interaction.user.username}님께서 ${interaction.guild?.name} 서버에 등록되었습니다.`);
  }

  return;
}

export async function RegisterUserMsg(interaction: Message) {
  // Server 등록
  if (!await Servers.findOne({ where: { id: interaction.guildId } })) {
    await Servers.create({ id: interaction.guildId });
    console.log(`${interaction.guild?.name} 서버가 데이터베이스에 등록되었습니다.`);
  }
  // User 등록
  if (!await Users.findOne({ where: { id: interaction.author.id } })) {
    await Users.create({ id: interaction.author.id });
    console.log(`${interaction.author.username}님께서 데이터베이스에 등록되었습니다.`);
  }
  // JoinedServer 등록
  if (!await JoinedServer.findOne({ where: { server_id: interaction.guildId, user_id: interaction.author.id } })) {
    await JoinedServer.create({ server_id: interaction.guildId, user_id: interaction.author.id });
    console.log(`${interaction.author.username}님께서 ${interaction.guild?.name} 서버에 등록되었습니다.`);
  }

  return;
}