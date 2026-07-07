/**
 * @fileoverview 로깅 시스템
 * @description 파일 기반 로깅 및 개발/프로덕션 모드 지원
 * @author kevin1113dev
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";

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
 * - 7일 이상 된 로그 자동 정리
 */
class Logger {
  /** 로그 파일 경로 */
  private logFilePath: string = "";
  
  /** 로그 파일 쓰기 스트림 */
  private logStream: fs.WriteStream | null = null;
  private shardId: number | undefined = undefined;

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
   * 로그 파일 초기화
   * 개발/프로덕션 모드에 따라 로그 폴더 생성 및 파일 생성
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

      // 봇 시작 시간으로 로그 파일명 생성 (한국 시간 사용)
      const startTime = getKoreaTime();
      const timestamp = startTime.toISOString()
        .replace(/:/g, "-")
        .replace(/\./g, "-")
        .replace("T", "_")
        .slice(0, 19); // YYYY-MM-DD_HH-MM-SS 형식

      const modePrefix = DEV_MODE ? "dev" : "prod";
      this.logFilePath = path.join(logsDir, `juhee_${timestamp}${this.shardId !== undefined ? `_shard${this.shardId}` : ""}.log`);
      
      // 로그 스트림 생성
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

      console.log(`📝 Log file created (${mode}): ${this.logFilePath}`);
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

  // 오래된 로그 파일 정리 (7일 이상)
  cleanupOldLogs(): void {
    try {
      // 현재 모드와 반대 모드 폴더 모두 정리
      const logsFolders = ["logs-dev", "logs-prod"];
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      let deletedCount = 0;

      logsFolders.forEach(folderName => {
        const logsDir = path.join(process.cwd(), folderName);
        if (!fs.existsSync(logsDir)) return;

        const files = fs.readdirSync(logsDir);

        files.forEach(file => {
          // 실제 로그 파일명은 `juhee_...log` 형식이다. (이전 버그: `juhee-bot_`로 검사해 아무것도 못 지웠음)
          if (file.startsWith("juhee_") && file.endsWith(".log")) {
            const filePath = path.join(logsDir, file);
            // 현재 사용 중인 로그 파일은 건너뜀
            if (filePath === this.logFilePath) return;
            try {
              const stats = fs.statSync(filePath);
              if (stats.mtime.getTime() < sevenDaysAgo) {
                fs.unlinkSync(filePath);
                deletedCount++;
                this.info(`🗑️ 오래된 로그 파일 삭제: ${folderName}/${file}`);
              }
            } catch (fileError) {
              // 개별 파일 처리 실패(다른 프로세스가 먼저 삭제 등)는 무시하고 계속
            }
          }
        });
      });

      if (deletedCount > 0) {
        this.info(`✅ 오래된 로그 정리 완료: ${deletedCount}개 삭제`);
      }
    } catch (error) {
      this.error("오래된 로그 정리 실패:", error);
    }
  }

  /**
   * 로그 자동 정리 스케줄러 시작
   * 시작 시 1회 정리하고 이후 24시간마다 반복한다.
   */
  startLogCleanupSchedule(): void {
    this.cleanupOldLogs();
    const timer = setInterval(() => this.cleanupOldLogs(), 24 * 60 * 60 * 1000);
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