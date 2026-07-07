/**
 * @fileoverview 로깅 시스템
 * @description 파일 기반 로깅 및 개발/프로덕션 모드 지원
 * @author kevin1113dev
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

/** 개발 모드 여부 */
const DEV_MODE: boolean = process.env.DEV_MODE === "true";

/** 한국 시간대 오프셋 (UTC+9) */
const koreaTimeDiff = 9 * 60 * 60 * 1000;

/**
 * 한국 시간 반환 헬퍼 함수
 * 
 * @param date - 변환할 날짜 (선택적)
 * @returns 한국 시간대로 변환된 Date 객체
 */
function getKoreaTime(date?: Date): Date {
  const now = date || new Date();
  return new Date(now.getTime() + koreaTimeDiff);
}

/**
 * 한국 시간 ISO 문자열 반환
 * 
 * @param date - 변환할 날짜 (선택적)
 * @returns ISO 형식의 한국 시간 문자열
 */
function getKoreaISOString(date?: Date): string {
  return getKoreaTime(date).toISOString();
}

/**
 * 로그 레벨 열거형
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

/**
 * 로거 클래스
 *
 * @remarks
 * - 파일과 콘솔 동시 로깅
 * - 개발/프로덕션 모드별 로그 폴더 분리
 * - 한국 시간대 지원
 * - Circular reference 처리
 * - 매일(KST 자정) 로그 파일 로테이션, 지난 파일은 gzip 압축 보관(삭제하지 않음)
 */
class Logger {
  /** 로그 파일 경로 */
  private logFilePath: string = "";

  /** 로그 파일 쓰기 스트림 */
  private logStream: fs.WriteStream | null = null;
  private shardId: number | undefined = undefined;

  /** 현재 활성 로그 파일의 KST 날짜 문자열 (YYYY-MM-DD) */
  private currentDateStr: string = "";

  /**
   * Logger 생성자
   * 로그 파일 초기화
   */
  constructor(shardLoggerConstructorOptions?: {
    shardId?: number;
  }) {
    this.shardId = shardLoggerConstructorOptions?.shardId;
    this.initializeLogFile();
  }

  /**
   * KST 날짜 문자열(YYYY-MM-DD) 반환
   *
   * @private
   */
  private getKoreaDateStr(date?: Date): string {
    return getKoreaTime(date).toISOString().slice(0, 10);
  }

  /**
   * 로그 파일 초기화
   * 개발/프로덕션 모드에 따라 로그 폴더 생성 및 (날짜별) 파일 생성
   *
   * @remarks
   * 파일명은 KST 날짜 기준(`juhee_YYYY-MM-DD[_shardN].log`)이라 같은 날의 재시작은
   * 동일 파일에 이어서 기록되고, 날짜가 바뀌면 새 파일로 로테이션된다.
   *
   * @private
   */
  private initializeLogFile(): void {
    try {
      // 개발 모드에 따라 로그 폴더 분리
      const logsFolderName = DEV_MODE ? "logs-dev" : "logs-prod";
      const logsDir = path.join(process.cwd(), logsFolderName);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // 날짜(KST)별 로그 파일명 생성
      this.currentDateStr = this.getKoreaDateStr();
      const shardSuffix =
        this.shardId !== undefined ? `_shard${this.shardId}` : "";
      this.logFilePath = path.join(
        logsDir,
        `juhee_${this.currentDateStr}${shardSuffix}.log`
      );

      // 로그 스트림 생성 (append: 같은 날 재시작 시 이어쓰기)
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: "a" });

      // 로그 파일 시작 헤더 작성 (한국 시간 사용)
      const mode = DEV_MODE ? "DEVELOPMENT" : "PRODUCTION";
      this.writeToFile(`=== Juhee Bot Log Started at ${getKoreaISOString()} (KST) ===\n`);
      this.writeToFile(`Mode: ${mode}\n`);
      this.writeToFile(`Process ID: ${process.pid}\n`);
      this.writeToFile(`Node Version: ${process.version}\n`);
      this.writeToFile(`Platform: ${process.platform}\n`);
      this.writeToFile(`DEV_MODE: ${DEV_MODE}\n`);
      if (this.shardId !== undefined) {
        this.writeToFile(`Shard ID: ${this.shardId}\n`);
      }
      this.writeToFile("=".repeat(60) + "\n\n");

      console.log(`📝 Log file (${mode}): ${this.logFilePath}`);
    } catch (error) {
      console.error("로그 파일 초기화 실패:", error);
    }
  }

  private writeToFile(message: string): void {
    if (this.logStream) {
      this.logStream.write(message);
    }
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = getKoreaISOString();
    return `[${timestamp}] [${level}] ${this.shardId !== undefined ? `[Shard ${this.shardId}] ` : ""}${message}`;
  }

  private log(level: LogLevel, levelName: string, message: string, ...args: any[]): void {
    const formattedMessage = this.formatMessage(levelName, message);
    
    // 콘솔 출력
    if (DEV_MODE || level >= LogLevel.INFO) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(formattedMessage, ...args);
          break;
        case LogLevel.INFO:
          console.info(formattedMessage, ...args);
          break;
        case LogLevel.WARN:
          console.warn(formattedMessage, ...args);
          break;
        case LogLevel.ERROR:
          console.error(formattedMessage, ...args);
          break;
      }
    }

    // 파일 출력 (circular reference 안전 처리)
    let fileMessage = formattedMessage;
    if (args.length > 0) {
      const argsString = args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          try {
            // 특수 객체 처리
            if (arg.constructor && arg.constructor.name) {
              if (arg.constructor.name === 'AudioResource') {
                return `[AudioResource: started=${arg.started}, duration=${arg.playbackDuration}]`;
              }
              if (arg.constructor.name === 'Error') {
                return `[Error: ${arg.message}]`;
              }
              if (arg.constructor.name === 'PassThrough') {
                return `[PassThrough: readable=${arg.readable}, writable=${arg.writable}]`;
              }
            }
            return JSON.stringify(arg, this.getCircularReplacer(), 2);
          } catch (error) {
            return `[${arg.constructor?.name || 'Object'}: <circular>]`;
          }
        }
        return String(arg);
      }).join(' ');
      fileMessage += ` ${argsString}`;
    }
    this.writeToFile(fileMessage + '\n');
  }

  // Circular reference를 처리하는 replacer 함수
  private getCircularReplacer(): (key: string, value: any) => any {
    const seen = new WeakSet();
    return (key: string, value: any) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }
      return value;
    };
  }

  debug(message: string, ...args: any[]): void {
    this.log(LogLevel.DEBUG, 'DEBUG', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.log(LogLevel.INFO, 'INFO', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.log(LogLevel.WARN, 'WARN', message, ...args);
  }

  error(message: string, error?: any, ...args: any[]): void {
    this.log(LogLevel.ERROR, 'ERROR', message, error, ...args);
  }

  // 봇 관련 특수 로그 메서드들
  botReady(tag: string): void {
    this.info(`🤖 봇이 준비되었습니다: ${tag}`);
  }

  commandRefresh(): void {
    this.info('🔄 슬래시 커맨드를 새로고침하는 중...');
  }

  commandRefreshSuccess(): void {
    this.info('✅ 슬래시 커맨드가 성공적으로 로드되었습니다');
  }

  serverNotRegistered(): void {
    this.warn("⚠️ 서버가 데이터베이스에 등록되지 않았습니다");
  }

  reconnectionFailed(error: any): void {
    this.error("🔌 음성 연결 재연결 실패:", error);
  }

  messageDeleteFailed(id: string, error: any): void {
    this.error(`🗑️ 메시지 삭제 실패 (ID: ${id}):`, error);
  }

  unhandledRejection(error: any): void {
    this.error('💥 처리되지 않은 Promise 거부:', error);
  }

  httpServerStart(port: number): void {
    this.info(`🌐 HTTP 서버가 포트 ${port}에서 시작되었습니다`);
  }

  httpServerClose(): void {
    this.info("🌐 HTTP 서버가 종료되었습니다");
  }

  httpError(error: any): void {
    this.error('🌐 HTTP 서버 오류:', error);
  }

  // 로그 파일 정리 메서드
  cleanup(): void {
    try {
      if (this.logStream) {
        this.writeToFile(`\n=== Juhee Bot Log Ended at ${getKoreaISOString()} (KST) ===\n`);
        this.logStream.end();
        this.logStream = null;
      }
    } catch (error) {
      console.error("로거 정리 실패:", error);
    }
  }

  /**
   * 단일 로그 파일을 gzip으로 압축 (스트리밍이라 메모리 사용 적음)
   * 원본 .log는 압축 성공 후 제거되지만 내용은 .gz에 그대로 보존된다.
   *
   * @private
   */
  private async gzipFile(srcPath: string): Promise<void> {
    const gzPath = srcPath + ".gz";
    // 이미 압축본이 있으면 건너뜀 (다른 프로세스가 먼저 처리한 경우 등)
    if (fs.existsSync(gzPath)) return;

    const tmpPath = `${gzPath}.tmp-${process.pid}-${Date.now()}`;
    await pipeline(
      fs.createReadStream(srcPath),
      zlib.createGzip(),
      fs.createWriteStream(tmpPath)
    );
    await fs.promises.rename(tmpPath, gzPath);
    // 원본 제거 (내용은 .gz에 보존 — 삭제가 아니라 압축 보관)
    await fs.promises.unlink(srcPath).catch(() => undefined);
  }

  /**
   * 지난 날짜의 로그 파일을 gzip으로 압축 보관 (삭제하지 않음)
   *
   * @remarks
   * - 오늘 날짜 파일과 현재 사용 중인 파일은 건너뛴다.
   * - 이미 .gz가 있으면 건너뛴다.
   */
  async compressOldLogs(): Promise<void> {
    try {
      const today = this.getKoreaDateStr();
      const logsFolders = ["logs-dev", "logs-prod"];
      let compressed = 0;

      for (const folderName of logsFolders) {
        const logsDir = path.join(process.cwd(), folderName);
        if (!fs.existsSync(logsDir)) continue;

        for (const file of fs.readdirSync(logsDir)) {
          if (!file.startsWith("juhee_") || !file.endsWith(".log")) continue;

          const filePath = path.join(logsDir, file);
          if (filePath === this.logFilePath) continue; // 현재 파일

          // 파일 날짜 판별 (파일명 우선, 없으면 mtime)
          const m = file.match(/(\d{4}-\d{2}-\d{2})/);
          let fileDate = m ? m[1] : null;
          if (!fileDate) {
            try {
              fileDate = this.getKoreaDateStr(fs.statSync(filePath).mtime);
            } catch {
              continue;
            }
          }
          // 오늘 날짜 파일은 아직 기록 중일 수 있으므로 건너뜀
          if (fileDate >= today) continue;

          try {
            await this.gzipFile(filePath);
            compressed++;
          } catch {
            // 개별 파일 압축 실패는 무시하고 계속
          }
        }
      }

      if (compressed > 0) {
        this.info(`🗜️ 지난 로그 압축 보관 완료: ${compressed}개 (.gz)`);
      }
    } catch (error) {
      this.error("로그 압축 실패:", error);
    }
  }

  /**
   * KST 날짜가 바뀌었으면 새 로그 파일로 전환하고 지난 파일을 압축한다.
   *
   * @private
   */
  private rotateIfNeeded(): void {
    try {
      const today = this.getKoreaDateStr();
      if (today === this.currentDateStr) return;

      // 날짜 변경 → 현재 스트림 종료 후 새 파일 오픈
      if (this.logStream) {
        this.writeToFile(
          `\n=== 날짜 변경으로 로그 파일 전환 (${this.currentDateStr} → ${today}) ===\n`
        );
        this.logStream.end();
        this.logStream = null;
      }
      this.initializeLogFile(); // currentDateStr 갱신 + 새 파일 오픈

      // 지난 날짜 파일 압축 보관
      void this.compressOldLogs();
    } catch (error) {
      console.error("로그 로테이션 실패:", error);
    }
  }

  /**
   * 로그 로테이션 스케줄러 시작
   * 시작 시 지난 로그를 압축하고, 이후 매 분 날짜 변경을 확인해 로테이션한다.
   */
  startLogRotationSchedule(): void {
    void this.compressOldLogs();
    const timer = setInterval(() => this.rotateIfNeeded(), 60 * 1000);
    // 이 타이머 때문에 프로세스가 종료되지 못하는 일이 없도록 unref
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  // 현재 로그 파일 경로 반환
  getLogFilePath(): string {
    return this.logFilePath;
  }
}

// let loggerInstance: Logger | undefined = undefined;
// function uninitializedLogger(): Logger {
//   console.error("Logger가 초기화되지 않았습니다. createLogger()를 먼저 호출하세요.");
//   process.exit(1);
//   return new Logger({}); // 이 줄은 실제로 실행되지 않음
// }

// export const createLogger = (shardId?: number): Logger => {
//   loggerInstance = new Logger({ shardId });
//   return loggerInstance;
// }
// export const logger: Logger = loggerInstance ?? uninitializedLogger();

export const logger = new Logger(process.env.SHARDS ? { shardId: parseInt(process.env.SHARDS, 10) } : {});