/**
 * @file deleteAllCommands.ts
 * @description 디스코드 봇의 슬래시 커맨드를 모두 삭제하는 스크립트
 * @author kevin1113dev
 * @version 1.0.0
 */

import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import dotenv from "dotenv";
import { logger } from "./logger.js";

dotenv.config();

const { TOKEN, CLIENT_ID, DEV_SERVER_ID, DEV_MODE } = process.env;

export default async function deleteAllCommands() {
  if (!TOKEN || !CLIENT_ID) {
    logger.error(
      "❌ TOKEN 또는 CLIENT_ID가 설정되지 않았습니다. .env 파일을 확인하세요."
    );
    process.exit(1);
  }
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    logger.commandRefresh();
    if (DEV_MODE) {
      if (!DEV_SERVER_ID) {
        logger.error(
          "❌ DEV_MODE가 활성화되어 있지만 DEV_SERVER_ID가 설정되지 않았습니다. .env 파일을 확인하세요."
        );
        process.exit(1);
      }
      const result = await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, DEV_SERVER_ID),
        { body: [] }
      );
      logger.debug("개발 서버용 슬래시 커맨드 삭제 결과:", result);
      logger.info(
        `✅ 개발 모드: 서버 ID ${DEV_SERVER_ID}에 슬래시 커맨드가 삭제되었습니다.`
      );
    }
    
    const result = await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: [],
    });
    logger.debug("글로벌 슬래시 커맨드 삭제 결과:", result);
    logger.info(`✅ 글로벌 모드: 모든 서버에 슬래시 커맨드가 삭제되었습니다.`);

    logger.commandRefreshSuccess();
  } catch (error) {
    logger.error("슬래시 커맨드 로드 실패:", error);
    process.exit(1);
  }
}

await deleteAllCommands();
