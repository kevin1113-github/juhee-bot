/**
 * @fileoverview HTTP 서버 관리 클래스
 * @description 공지 전송, 상태 조회, 설정 토글을 위한 HTTP 엔드포인트 제공
 * @author kevin1113dev
 */

import { Client, EmbedBuilder, PartialGroupDMChannel } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

/** HTTP 요청 인증을 위한 비밀번호 */
const REQUEST_PASSWORD: string = process.env.REQUEST_PASSWORD ?? "";
/** 주희봇 URL (로그 파일 접근용) */
const JUHEE_URL: string = process.env.JUHEE_URL ?? "";
/** 포트 번호 */
const PORT: number = (() => {
  const p = parseInt(process.env.PORT ?? "8080", 10);
  return isNaN(p) ? 8080 : p;
})();

import http from "http";
import { JoinedServer, Servers, Users } from "./dbObject.js";
import { DATA } from "./types.js";
import { logger } from "./logger.js";

import { Console } from "node:console";
import { Transform } from "node:stream";
import path from "node:path";
import fs from "node:fs";
import { create } from "node:domain";
import { createEmbedMessage } from "./action.js";

const ts: Transform = new Transform({
  transform(chunk, _enc, cb) {
    cb(null, chunk);
  },
});
const tableLogger = new Console({ stdout: ts });

function getTable(data: any) {
  tableLogger.table(data);
  return (ts.read() || "").toString();
}

/** 언어 인식 옵션 (현재 미사용) */
export let recognizeOption = false;

/**
 * HTTP 서버 관리 클래스
 * 
 * @remarks
 * - POST /notice: 모든 서버에 공지 전송
 * - POST /toggleRecognize: 언어 인식 토글
 * - POST /status: 상태 정보 조회
 * - GET /status/{filename}: 상태 파일 다운로드
 */
export default class HttpServer {
  /** HTTP 서버 인스턴스 */
  private server: http.Server;
  
  /** Discord 클라이언트 */
  private client: Client;

  /**
   * 모든 서버의 TTS 채널에 공지 전송
   * 
   * @param data - 전송할 임베드 메시지
   * @private
   */
  private async notice(data: EmbedBuilder) {
    try {
      await Servers.sync();
      const servers: DATA[] = await Servers.findAll();
      logger.info(`📢 Sending notice to ${servers.length} servers`);
      
      let successCount = 0;
      let failureCount = 0;
      let missingAccessCount = 0;
      let unknownChannelCount = 0;
      let otherErrorCount = 0;
      let noChannelCount = 0;
      
      for (const server of servers) {
        const ttsChannel = server.dataValues.ttsChannel;
        if (!ttsChannel) {
          noChannelCount++;
          logger.debug(`⚠️ Server ${server.dataValues.id} has no TTS channel configured`);
          continue;
        }

        try {
          const channel = await this.client.channels.fetch(ttsChannel);
          if (
            channel?.isTextBased() &&
            !(channel instanceof PartialGroupDMChannel)
          ) {
            await channel.send({ embeds: [data] });
            logger.debug(`✅ Notice sent to server ${server.dataValues.id}`);
            successCount++;
          } else {
            logger.warn(`⚠️ Channel ${ttsChannel} in server ${server.dataValues.id} is not a valid text channel`);
            otherErrorCount++;
            failureCount++;
          }
        } catch (e: any) {
          failureCount++;
          
          // Discord API 에러 코드별 처리
          if (e.code === 50001) {
            // Missing Access
            missingAccessCount++;
            logger.warn(`🔒 Missing access to channel ${ttsChannel} in server ${server.dataValues.id}`);
          } else if (e.code === 10003) {
            // Unknown Channel
            unknownChannelCount++;
            logger.warn(`❌ Channel ${ttsChannel} not found in server ${server.dataValues.id} - channel may have been deleted`);
          } else if (e.code === 50013) {
            // Missing Permissions
            logger.warn(`⛔ Missing permissions to send message to channel ${ttsChannel} in server ${server.dataValues.id}`);
            otherErrorCount++;
          } else if (e.code === 10004) {
            // Unknown Guild
            logger.warn(`❌ Server ${server.dataValues.id} not found - bot may have been kicked`);
            otherErrorCount++;
          } else {
            // 기타 에러
            otherErrorCount++;
            logger.error(`❌ Failed to send notice to channel ${ttsChannel} in server ${server.dataValues.id}:`, {
              code: e.code,
              message: e.message,
              status: e.status,
              method: e.method,
              url: e.url
            });
          }
        }
      }
      
      // 공지 전송 결과 요약
      logger.info(`📊 Notice sending completed: ${successCount} successful, ${failureCount} failed out of ${servers.length} servers`);
      if (failureCount > 0) {
        logger.info(`📋 Failure breakdown: ${missingAccessCount} missing access, ${unknownChannelCount} unknown channels, ${otherErrorCount} other errors, ${noChannelCount} no channel configured`);
      }
      
    } catch (error) {
      logger.error("❌ Critical error occurred while sending notices:", error);
    }
  }

  /**
   * 봇의 현재 상태 정보 생성
   * 서버, 사용자, 관계 정보를 표 형식으로 반환
   * 
   * @returns 상태 파일 URL
   * @private
   */
  private async status(): Promise<String> {
    try {
      const servers = await Servers.findAll();
      const users = await Users.findAll();
      const joinedServers = await JoinedServer.findAll();
      
      logger.info(`📊 Generating status report for ${servers.length} servers, ${users.length} users`);

      const result = async () => {
        const serverData = await Promise.all(
          servers.map(async (server) => {
            try {
              const serverInstance = await this.client.guilds.fetch(
                server.dataValues.id
              );
              return { id: server.dataValues.id, name: serverInstance.name };
            } catch (error) {
              logger.warn(`Failed to fetch server ${server.dataValues.id}:`, error);
              return { id: server.dataValues.id, name: "알 수 없음" };
            }
          })
        );

      const userData = await Promise.all(
        users.map(async (user) => {
          const userInstance = await this.client.users.fetch(
            user.dataValues.id
          );
          return {
            id: user.dataValues.id,
            globalName: userInstance.globalName || "-",
            displayName: userInstance.displayName,
            username: userInstance.username,
          };
        })
      );

      const joinData = await Promise.all(
        joinedServers.map(async (joined) => {
          try {
            const serverInstance = await this.client.guilds.fetch(
              joined.dataValues.server_id
            );
            const userInstance = await this.client.users.fetch(
              joined.dataValues.user_id
            );
            const memberInstance = await serverInstance.members.fetch(
              joined.dataValues.user_id
            );
            return {
              server_id: joined.dataValues.server_id,
              server_name: serverInstance.name,
              user_id: joined.dataValues.user_id,
              username: userInstance.username,
              member_displayName: memberInstance.displayName,
            };
          } catch (error) {
            return {
              server_id: joined.dataValues.server_id,
              server_name: "알 수 없음",
              user_id: joined.dataValues.user_id,
              username: "알 수 없음",
              member_displayName: "알 수 없음",
            };
          }
        })
      );

      const output =
        "[ 서버 정보 ]\n" +
        getTable(serverData) +
        "\n[ 사용자 정보 ]\n" +
        getTable(userData) +
        "\n[ 서버-사용자 연결 정보 ]\n" +
        getTable(joinData);

      return output;
    };

    const timestamp = Date.now();
    const filename = `status_${timestamp}.txt`;
    const statusDir = path.join(process.cwd(), "public", "status");
    const filepath = path.join(statusDir, filename);

    // public 디렉토리 생성
    fs.mkdirSync(statusDir, { recursive: true });

    // 오래된 status 파일 정리 (1일 이상 경과분 삭제 - 디스크 누적 방지)
    try {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      for (const file of fs.readdirSync(statusDir)) {
        if (!file.startsWith("status_") || !file.endsWith(".txt")) continue;
        const oldPath = path.join(statusDir, file);
        try {
          if (fs.statSync(oldPath).mtimeMs < oneDayAgo) {
            fs.unlinkSync(oldPath);
          }
        } catch {
          // 개별 파일 처리 실패는 무시
        }
      }
    } catch (cleanupError) {
      logger.warn("⚠️ 오래된 status 파일 정리 실패:", cleanupError);
    }

    // 결과를 파일로 저장
    fs.writeFileSync(filepath, await result());

    // 공개 URL 생성
    const publicUrl = `${JUHEE_URL}:${PORT}/status/${filename}`;

    return publicUrl;
    } catch (error) {
      logger.error("Failed to generate status report:", error);
      return "Error generating status report";
    }
  }

  /**
   * HTTP 요청 핸들러
   * 각종 POST/GET 엔드포인트 처리
   * 
   * @private
   */
  private requestHandler = (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => {
    // POST 요청 크기 제한 (1MB)
    const MAX_POST_SIZE = 1024 * 1024; // 1MB
    
    if (req.url === "/notice" && req.method === "POST") {
      let postData: string = "";
      let dataSize = 0;
      
      req.on("data", (data) => {
        dataSize += data.length;
        
        // 크기 제한 초과 확인
        if (dataSize > MAX_POST_SIZE) {
          logger.warn(`⚠️ POST request size limit exceeded: ${dataSize} bytes`);
          res.writeHead(413, { "Content-Type": "text/plain" });
          res.end("Payload too large");
          req.destroy();
          return;
        }
        
        postData += typeof data === "string" ? data : data.toString();
      });
      req.on("end", async () => {
        const password = postData.split(",")[0];
        postData = postData.split(",").slice(1).join(",");
        postData = postData.replace(/\\n/g, "\n");
        const title: string = postData.split("\n")[0];
        postData = postData.replace(title + "\n", "");
        if (
          password.startsWith("password=") &&
          password.split("=")[1] === REQUEST_PASSWORD
        ) {
          const embed = createEmbedMessage(title, postData);
          await this.notice(embed);
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.write("OK");
        res.end();
      });
    } else if (req.url === "/toggleRecognize" && req.method === "POST") {
      let postData: string = "";
      let dataSize = 0;
      
      req.on("data", (data) => {
        dataSize += data.length;
        
        if (dataSize > MAX_POST_SIZE) {
          logger.warn(`⚠️ POST request size limit exceeded: ${dataSize} bytes`);
          res.writeHead(413, { "Content-Type": "text/plain" });
          res.end("Payload too large");
          req.destroy();
          return;
        }
        
        postData += typeof data === "string" ? data : data.toString();
      });
      req.on("end", async () => {
        const password = postData;
        if (
          password.startsWith("password=") &&
          password.split("=")[1] === REQUEST_PASSWORD
        ) {
          recognizeOption = !recognizeOption;
          res.writeHead(200, { "Content-Type": "text/html" });
          res.write(recognizeOption ? "recognizeOption is enabled." : "recognizeOption is disabled.");
          res.end();
        }
        else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.write("error");
          res.end();
        }
      });
    } else if (req.url === "/status" && req.method === "POST") {
      let postData: string = "";
      let dataSize = 0;
      
      req.on("data", (data) => {
        dataSize += data.length;
        
        if (dataSize > MAX_POST_SIZE) {
          logger.warn(`⚠️ POST request size limit exceeded: ${dataSize} bytes`);
          res.writeHead(413, { "Content-Type": "text/plain" });
          res.end("Payload too large");
          req.destroy();
          return;
        }
        
        postData += typeof data === "string" ? data : data.toString();
      });
      req.on("end", async () => {
        const password = postData;
        if (
          password.startsWith("password=") &&
          password.split("=")[1] === REQUEST_PASSWORD
        ) {
          const statusUrl = await this.status();
          res.writeHead(200, { "Content-Type": "text/html" });
          res.write(statusUrl);
          res.end();
        }
        else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.write("error");
          res.end();
        }
      });
    } else if (req.url?.startsWith('/status/') && req.method === "GET") {
      try {
        // Path traversal 공격 방지
        const requestedFile = req.url.substring(8); // '/status/' 제거
        
        // 파일명 검증: 알파벳, 숫자, 언더스코어, 점, 하이픈만 허용
        const safeFilenameRegex = /^[a-zA-Z0-9_.-]+$/;
        if (!safeFilenameRegex.test(requestedFile)) {
          logger.warn(`⚠️ Suspicious file request blocked: ${requestedFile}`);
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end('Invalid filename');
          return;
        }
        
        // 상대 경로(.., ./) 포함 여부 확인
        if (requestedFile.includes('..') || requestedFile.includes('./')) {
          logger.warn(`⚠️ Path traversal attempt blocked: ${requestedFile}`);
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end('Invalid path');
          return;
        }
        
        // .txt 파일만 허용
        if (!requestedFile.endsWith('.txt')) {
          logger.warn(`⚠️ Non-txt file request blocked: ${requestedFile}`);
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end('Only .txt files allowed');
          return;
        }
        
        // 안전한 경로 구성
        const safePath = path.join(process.cwd(), 'public', 'status', path.basename(requestedFile));
        
        // 최종 경로가 public/status 디렉토리 내에 있는지 확인
        const publicStatusDir = path.join(process.cwd(), 'public', 'status');
        const resolvedPath = path.resolve(safePath);
        if (!resolvedPath.startsWith(publicStatusDir)) {
          logger.warn(`⚠️ Path escape attempt blocked: ${resolvedPath}`);
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end('Access denied');
          return;
        }
        
        // 파일 읽기
        fs.readFile(resolvedPath, (err, data) => {
          if (err) {
            logger.warn(`📄 Status file not found: ${requestedFile}`);
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end('File not found');
            return;
          }
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(data);
          logger.debug(`📄 Status file served: ${requestedFile}`);
        });
      } catch (error) {
        logger.error("Error serving status file:", error);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end('Internal server error');
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.write("<h1>404 Not Found</h1>");
      res.end();
    }
  };

  /**
   * HttpServer 생성자
   * 
   * @param client - Discord 클라이언트 인스턴스
   */
  constructor(client: Client) {
    this.server = http.createServer(this.requestHandler);
    this.client = client;
  }

  /**
   * HTTP 서버 시작
   */
  start() {
    try {
      this.server.listen(PORT, () => {
        logger.httpServerStart(PORT);
      });
      
      this.server.on('error', (error) => {
        logger.httpError(error);
      });
    } catch (error) {
      logger.httpError(error);
    }
  }

  /**
   * HTTP 서버 종료
   */
  stop() {
    try {
      this.server.close(() => {
        logger.httpServerClose();
      });
    } catch (error) {
      logger.error("Failed to close HTTP server:", error);
    }
  }
}
