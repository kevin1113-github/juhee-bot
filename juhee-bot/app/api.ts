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
import os from "node:os";
import crypto from "node:crypto";
import { create } from "node:domain";
import { createEmbedMessage } from "./action.js";
import { DASHBOARD_HTML } from "./dashboard.js";

/** 대시보드 세션 유효시간 (12시간) */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** 세션 쿠키 이름 */
const SESSION_COOKIE = "dash_session";
/** 로그인 실패 임계치 및 잠금시간 */
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
/** 로그 조회 시 파일 끝에서 읽을 최대 바이트 (256KB) */
const LOG_TAIL_BYTES = 256 * 1024;
/** 로그 폴더 허용 목록 */
const ALLOWED_LOG_FOLDERS = ["logs", "logs-dev", "logs-prod"];
/** 로그 파일명 허용 패턴 (.log 및 압축본 .log.gz) */
const LOG_FILE_REGEX = /^[A-Za-z0-9_.-]+\.log(\.gz)?$/;

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

  /** 대시보드 세션 저장소 (token -> 만료 시각 ms) */
  private sessions: Map<string, number> = new Map();

  /** 로그인 실패 추적 (IP -> { count, until }) */
  private loginAttempts: Map<string, { count: number; until: number }> =
    new Map();

  /**
   * 모든 서버의 TTS 채널에 공지 전송
   * 
   * @param data - 전송할 임베드 메시지
   * @private
   */
  private async notice(
    data: EmbedBuilder
  ): Promise<{ success: number; failure: number; total: number }> {
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

      return { success: successCount, failure: failureCount, total: servers.length };
    } catch (error) {
      logger.error("❌ Critical error occurred while sending notices:", error);
      return { success: 0, failure: 0, total: 0 };
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

  // ===================== 관리자 대시보드 =====================

  /** 요청 클라이언트 IP 추출 */
  private getClientIp(req: http.IncomingMessage): string {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
    return req.socket.remoteAddress ?? "unknown";
  }

  /** 쿠키 헤더 파싱 */
  private parseCookies(req: http.IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};
    const raw = req.headers.cookie;
    if (!raw) return out;
    for (const part of raw.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
    return out;
  }

  /** 세션 쿠키 유효성 검사 */
  private isAuthed(req: http.IncomingMessage): boolean {
    const token = this.parseCookies(req)[SESSION_COOKIE];
    if (!token) return false;
    const exp = this.sessions.get(token);
    if (!exp) return false;
    if (Date.now() > exp) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  /** 비밀번호 상수시간 비교 */
  private verifyPassword(input: string): boolean {
    if (!REQUEST_PASSWORD) return false;
    const a = Buffer.from(input);
    const b = Buffer.from(REQUEST_PASSWORD);
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** 새 세션 발급 + Set-Cookie */
  private issueSession(res: http.ServerResponse): void {
    const now = Date.now();
    for (const [t, exp] of this.sessions) if (exp < now) this.sessions.delete(t);

    const token = crypto.randomBytes(32).toString("hex");
    this.sessions.set(token, now + SESSION_TTL_MS);
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Strict`
    );
  }

  /** 세션 파기 */
  private clearSession(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const token = this.parseCookies(req)[SESSION_COOKIE];
    if (token) this.sessions.delete(token);
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`
    );
  }

  private isLocked(ip: string): boolean {
    const rec = this.loginAttempts.get(ip);
    return !!rec && rec.until > Date.now();
  }

  private recordLoginFail(ip: string): void {
    const rec = this.loginAttempts.get(ip) ?? { count: 0, until: 0 };
    rec.count += 1;
    if (rec.count >= LOGIN_MAX_ATTEMPTS) {
      rec.until = Date.now() + LOGIN_LOCK_MS;
      rec.count = 0;
    }
    this.loginAttempts.set(ip, rec);
  }

  private clearLoginFail(ip: string): void {
    this.loginAttempts.delete(ip);
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    body: unknown
  ): void {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(body));
  }

  /** 요청 본문 읽기 (크기 제한 초과 시 413 후 null 반환) */
  private readBody(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    maxSize: number
  ): Promise<string | null> {
    return new Promise((resolve) => {
      let data = "";
      let size = 0;
      req.on("data", (chunk: Buffer | string) => {
        size += chunk.length;
        if (size > maxSize) {
          res.writeHead(413, { "Content-Type": "text/plain" });
          res.end("Payload too large");
          req.destroy();
          resolve(null);
          return;
        }
        data += typeof chunk === "string" ? chunk : chunk.toString();
      });
      req.on("end", () => resolve(data));
      req.on("error", () => resolve(null));
    });
  }

  /** TTS 캐시 통계 + 캐시 폴더 용량 수집 */
  private readTtsStats(): {
    hits: number;
    misses: number;
    inflightWaits: number;
    errors: number;
    cacheFiles: number;
    cacheBytes: number;
  } {
    const totals = {
      hits: 0,
      misses: 0,
      inflightWaits: 0,
      errors: 0,
      cacheFiles: 0,
      cacheBytes: 0,
    };
    try {
      const dir = process.env.TTS_CACHE_DIR
        ? path.resolve(process.env.TTS_CACHE_DIR)
        : path.join(process.cwd(), ".ttsCache");
      if (!fs.existsSync(dir)) return totals;

      for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);
        if (
          file.startsWith("tts-stats-") &&
          file.toLowerCase().endsWith(".json")
        ) {
          try {
            const s = JSON.parse(fs.readFileSync(full, "utf8"));
            totals.hits += Number(s?.hits ?? 0) || 0;
            totals.misses += Number(s?.misses ?? 0) || 0;
            totals.inflightWaits += Number(s?.inflightWaits ?? 0) || 0;
            totals.errors += Number(s?.errors ?? 0) || 0;
          } catch {
            // 개별 파일 파싱 실패 무시
          }
        } else if (file.endsWith(".pcm")) {
          try {
            totals.cacheFiles += 1;
            totals.cacheBytes += fs.statSync(full).size;
          } catch {
            // 무시
          }
        }
      }
    } catch (e) {
      logger.warn("⚠️ TTS 통계 수집 실패:", e);
    }
    return totals;
  }

  /** 리눅스 스왑 사용량 (/proc/meminfo) */
  private readSwapInfo(): { swapTotal: number; swapUsed: number } {
    try {
      if (process.platform === "linux" && fs.existsSync("/proc/meminfo")) {
        const info = fs.readFileSync("/proc/meminfo", "utf8");
        const total = /SwapTotal:\s+(\d+)\s+kB/.exec(info);
        const free = /SwapFree:\s+(\d+)\s+kB/.exec(info);
        if (total && free) {
          const t = parseInt(total[1], 10) * 1024;
          const f = parseInt(free[1], 10) * 1024;
          return { swapTotal: t, swapUsed: t - f };
        }
      }
    } catch {
      // 무시
    }
    return { swapTotal: 0, swapUsed: 0 };
  }

  /** 개요/시스템/TTS 통계 집계 */
  private async gatherStats() {
    let perShard: number[] = [];
    let shardCount = 1;
    let totalRss = 0;
    try {
      if (this.client.shard) {
        perShard = (await this.client.shard.fetchClientValues(
          "guilds.cache.size"
        )) as number[];
        shardCount = this.client.shard.count;
        const rss = (await this.client.shard.broadcastEval(() =>
          process.memoryUsage().rss
        )) as number[];
        totalRss = rss.reduce((a, b) => a + (Number(b) || 0), 0);
      } else {
        perShard = [this.client.guilds.cache.size];
        totalRss = process.memoryUsage().rss;
      }
    } catch (e) {
      logger.warn("⚠️ 샤드 통계 수집 실패:", e);
      perShard = [this.client.guilds.cache.size];
      totalRss = process.memoryUsage().rss;
    }
    const totalGuilds = perShard.reduce((a, b) => a + (Number(b) || 0), 0);

    const [userCount, joinCount] = await Promise.all([
      Users.count(),
      JoinedServer.count(),
    ]);

    const tts = this.readTtsStats();
    const swap = this.readSwapInfo();
    const memTotal = os.totalmem();
    const memFree = os.freemem();

    return {
      bot: {
        totalGuilds,
        userCount,
        joinCount,
        shardCount,
        perShard,
        totalRss,
        uptimeSec:
          this.client.uptime != null
            ? Math.floor(this.client.uptime / 1000)
            : Math.floor(process.uptime()),
      },
      system: {
        memTotal,
        memUsed: memTotal - memFree,
        swapTotal: swap.swapTotal,
        swapUsed: swap.swapUsed,
        load1: os.loadavg()[0],
        cpuCount: os.cpus().length,
        osUptimeSec: Math.floor(os.uptime()),
        nodeVersion: process.version,
      },
      tts,
      recognizeOption,
    };
  }

  /** 서버 목록 집계 */
  private async gatherServers() {
    const servers: DATA[] = await Servers.findAll();
    const list = servers.map((sv) => {
      const id = sv.dataValues.id as string;
      const guild = this.client.guilds.cache.get(id);
      return {
        id,
        name: guild?.name ?? "(캐시에 없음/다른 샤드)",
        ttsChannel: sv.dataValues.ttsChannel ?? null,
        isMuted: !!sv.dataValues.isMuted,
        memberCount: guild?.memberCount ?? null,
      };
    });
    list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return list;
  }

  /** 로그 파일 목록 */
  private listLogFiles() {
    const files: {
      folder: string;
      name: string;
      size: number;
      mtime: string;
      mtimeMs: number;
    }[] = [];
    for (const folder of ALLOWED_LOG_FOLDERS) {
      const dir = path.join(process.cwd(), folder);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".log") && !name.endsWith(".log.gz")) continue;
        try {
          const st = fs.statSync(path.join(dir, name));
          files.push({
            folder,
            name,
            size: st.size,
            mtime: new Date(st.mtimeMs).toISOString(),
            mtimeMs: st.mtimeMs,
          });
        } catch {
          // 무시
        }
      }
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files;
  }

  /** 로그 파일 경로 안전 검증 후 절대경로 반환 (실패 시 null) */
  private resolveLogFile(
    folder: string | null,
    file: string | null
  ): string | null {
    if (!folder || !file) return null;
    if (!ALLOWED_LOG_FOLDERS.includes(folder)) return null;
    if (!LOG_FILE_REGEX.test(file)) return null;
    const base = path.basename(file);
    const dir = path.resolve(path.join(process.cwd(), folder));
    const full = path.resolve(path.join(dir, base));
    if (full !== dir && !full.startsWith(dir + path.sep)) return null;
    if (!full.endsWith(".log") && !full.endsWith(".log.gz")) return null;
    if (!fs.existsSync(full)) return null;
    return full;
  }

  /** 로그 파일 끝부분 읽기 */
  private async tailLog(full: string, maxBytes: number): Promise<string> {
    const st = await fs.promises.stat(full);
    if (st.size <= maxBytes) {
      return await fs.promises.readFile(full, "utf8");
    }
    const start = st.size - maxBytes;
    const fh = await fs.promises.open(full, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      await fh.read(buf, 0, maxBytes, start);
      const text = buf.toString("utf8");
      const nl = text.indexOf("\n");
      const trimmed = nl >= 0 ? text.slice(nl + 1) : text;
      return (
        `... (앞부분 생략, 마지막 ${Math.floor(maxBytes / 1024)}KB 표시) ...\n` +
        trimmed
      );
    } finally {
      await fh.close();
    }
  }

  /** 대시보드/관리 API 라우팅 */
  private async handleAdmin(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const pathname = (req.url || "").split("?")[0];
      const method = req.method || "GET";

      // 대시보드 페이지
      if ((pathname === "/" || pathname === "/admin") && method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
        });
        res.end(DASHBOARD_HTML);
        return;
      }

      // 로그인
      if (pathname === "/admin/login" && method === "POST") {
        const ip = this.getClientIp(req);
        if (this.isLocked(ip)) {
          res.writeHead(429, { "Content-Type": "text/plain" });
          res.end("Too many attempts");
          return;
        }
        const body = await this.readBody(req, res, 4096);
        if (body === null) return;
        const pw = new URLSearchParams(body).get("password") ?? "";
        if (this.verifyPassword(pw)) {
          this.clearLoginFail(ip);
          this.issueSession(res);
          this.sendJson(res, 200, { ok: true });
        } else {
          this.recordLoginFail(ip);
          this.sendJson(res, 401, { ok: false });
        }
        return;
      }

      // 로그아웃
      if (pathname === "/admin/logout" && method === "POST") {
        this.clearSession(req, res);
        this.sendJson(res, 200, { ok: true });
        return;
      }

      // 이하 /admin/api/* 는 인증 필요
      if (pathname.startsWith("/admin/api/")) {
        if (!this.isAuthed(req)) {
          this.sendJson(res, 401, { error: "unauthorized" });
          return;
        }

        if (pathname === "/admin/api/stats" && method === "GET") {
          this.sendJson(res, 200, await this.gatherStats());
          return;
        }
        if (pathname === "/admin/api/servers" && method === "GET") {
          this.sendJson(res, 200, { servers: await this.gatherServers() });
          return;
        }
        if (pathname === "/admin/api/logs" && method === "GET") {
          this.sendJson(res, 200, { files: this.listLogFiles() });
          return;
        }
        if (pathname === "/admin/api/logs/view" && method === "GET") {
          const q = new URL(req.url || "", "http://localhost");
          const full = this.resolveLogFile(
            q.searchParams.get("folder"),
            q.searchParams.get("file")
          );
          if (!full) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid file");
            return;
          }
          if (full.endsWith(".gz")) {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(
              "압축된 로그(.gz)입니다. 내용을 보려면 [다운로드] 후 압축을 해제하세요."
            );
            return;
          }
          const text = await this.tailLog(full, LOG_TAIL_BYTES);
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(text);
          return;
        }
        if (pathname === "/admin/api/logs/download" && method === "GET") {
          const q = new URL(req.url || "", "http://localhost");
          const full = this.resolveLogFile(
            q.searchParams.get("folder"),
            q.searchParams.get("file")
          );
          if (!full) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid file");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${path.basename(
              full
            )}"`,
          });
          fs.createReadStream(full).pipe(res);
          return;
        }
        if (pathname === "/admin/api/notice" && method === "POST") {
          const body = await this.readBody(req, res, 1024 * 1024);
          if (body === null) return;
          let title = "";
          let content = "";
          try {
            const j = JSON.parse(body);
            title = String(j.title ?? "");
            content = String(j.content ?? "");
          } catch {
            // 무시
          }
          if (!title) {
            this.sendJson(res, 400, { error: "title required" });
            return;
          }
          const embed = createEmbedMessage(title, content);
          const result = await this.notice(embed);
          this.sendJson(res, 200, result);
          return;
        }
        if (
          pathname === "/admin/api/toggleRecognize" &&
          method === "POST"
        ) {
          recognizeOption = !recognizeOption;
          this.sendJson(res, 200, { recognizeOption });
          return;
        }

        this.sendJson(res, 404, { error: "not found" });
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (error) {
      logger.error("대시보드 요청 처리 오류:", error);
      try {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal server error");
      } catch {
        // 무시
      }
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
    // 대시보드/관리 라우트 우선 처리
    const pathname = (req.url || "").split("?")[0];
    if (
      pathname === "/" ||
      pathname === "/admin" ||
      pathname.startsWith("/admin/")
    ) {
      void this.handleAdmin(req, res);
      return;
    }

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
