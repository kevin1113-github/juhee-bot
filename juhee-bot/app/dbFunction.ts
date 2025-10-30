/**
 * @fileoverview 데이터베이스 사용자 등록 함수
 * @description 서버, 사용자, 서버-사용자 관계를 데이터베이스에 등록
 * @author kevin1113dev
 */

import { Interaction, Message } from 'discord.js';
import { Servers, Users, JoinedServer } from './dbObject.js';
import { logger } from './logger.js';

/**
 * 인터랙션에서 사용자 및 서버 정보를 데이터베이스에 등록
 * 
 * @param interaction - Discord 인터랙션 객체
 * @throws {Error} 등록 중 오류 발생 시
 * 
 * @remarks
 * - 서버가 없으면 자동 생성
 * - 사용자가 없으면 자동 생성
 * - 서버-사용자 관계가 없으면 자동 생성
 * - findOrCreate를 사용하여 경쟁 조건 방지
 */
export async function RegisterUser(interaction: Interaction) {
  try {
    // Server 등록 (findOrCreate로 경쟁 조건 방지)
    const [server, serverCreated] = await Servers.findOrCreate({
      where: { id: interaction.guildId },
      defaults: { id: interaction.guildId }
    });
    if (serverCreated) {
      logger.info(`✅ 서버 "${interaction.guild?.name}" (${interaction.guildId}) 데이터베이스에 등록`);
    }
    
    // User 등록 (findOrCreate로 경쟁 조건 방지)
    const [user, userCreated] = await Users.findOrCreate({
      where: { id: interaction.user.id },
      defaults: { id: interaction.user.id }
    });
    if (userCreated) {
      logger.info(`✅ 사용자 "${interaction.user.username}" (${interaction.user.id}) 데이터베이스에 등록`);
    }
    
    // JoinedServer 등록 (findOrCreate로 경쟁 조건 방지)
    const [joinedServer, joinCreated] = await JoinedServer.findOrCreate({
      where: { server_id: interaction.guildId, user_id: interaction.user.id },
      defaults: { server_id: interaction.guildId, user_id: interaction.user.id }
    });
    if (joinCreated) {
      logger.info(`✅ 사용자 "${interaction.user.username}"가 서버 "${interaction.guild?.name}"에 참가`);
    }
  } catch (error) {
    logger.error("인터랙션에서 사용자 등록 실패:", error);
    throw error;
  }
}

/**
 * 메시지에서 사용자 및 서버 정보를 데이터베이스에 등록
 * 
 * @param interaction - Discord 메시지 객체
 * @throws {Error} 등록 중 오류 발생 시
 * 
 * @remarks
 * RegisterUser와 동일하지만 Message 객체 사용
 */
export async function RegisterUserMsg(interaction: Message) {
  try {
    // Server 등록 (findOrCreate로 경쟁 조건 방지)
    const [server, serverCreated] = await Servers.findOrCreate({
      where: { id: interaction.guildId },
      defaults: { id: interaction.guildId }
    });
    if (serverCreated) {
      logger.info(`✅ 서버 "${interaction.guild?.name}" (${interaction.guildId}) 데이터베이스에 등록`);
    }
    
    // User 등록 (findOrCreate로 경쟁 조건 방지)
    const [user, userCreated] = await Users.findOrCreate({
      where: { id: interaction.author.id },
      defaults: { id: interaction.author.id }
    });
    if (userCreated) {
      logger.info(`✅ 사용자 "${interaction.author.username}" (${interaction.author.id}) 데이터베이스에 등록`);
    }
    
    // JoinedServer 등록 (findOrCreate로 경쟁 조건 방지)
    const [joinedServer, joinCreated] = await JoinedServer.findOrCreate({
      where: { server_id: interaction.guildId, user_id: interaction.author.id },
      defaults: { server_id: interaction.guildId, user_id: interaction.author.id }
    });
    if (joinCreated) {
      logger.info(`✅ 사용자 "${interaction.author.username}"가 서버 "${interaction.guild?.name}"에 참가`);
    }
  } catch (error) {
    logger.error("메시지에서 사용자 등록 실패:", error);
    throw error;
  }
}