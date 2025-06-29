import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";

const DEV_MODE: boolean = process.env.DEV_MODE === "true";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

class Logger {
  private logFilePath: string = "";
  private logStream: fs.WriteStream | null = null;

  constructor() {
    this.initializeLogFile();
  }

  private initializeLogFile(): void {
    try {
      // 개발 모드에 따라 로그 폴더 분리
      const logsFolderName = DEV_MODE ? "logs-dev" : "logs-prod";
      const logsDir = path.join(process.cwd(), logsFolderName);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // 봇 시작 시간으로 로그 파일명 생성
      const startTime = new Date();
      const timestamp = startTime.toISOString()
        .replace(/:/g, "-")
        .replace(/\./g, "-")
        .replace("T", "_")
        .slice(0, 19); // YYYY-MM-DD_HH-MM-SS 형식

      const modePrefix = DEV_MODE ? "dev" : "prod";
      this.logFilePath = path.join(logsDir, `juhee-bot_${modePrefix}_${timestamp}.log`);
      
      // 로그 스트림 생성
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: "a" });
      
      // 로그 파일 시작 헤더 작성
      const mode = DEV_MODE ? "DEVELOPMENT" : "PRODUCTION";
      this.writeToFile(`=== Juhee Bot Log Started at ${startTime.toISOString()} ===\n`);
      this.writeToFile(`Mode: ${mode}\n`);
      this.writeToFile(`Process ID: ${process.pid}\n`);
      this.writeToFile(`Node Version: ${process.version}\n`);
      this.writeToFile(`Platform: ${process.platform}\n`);
      this.writeToFile(`DEV_MODE: ${DEV_MODE}\n`);
      this.writeToFile("=".repeat(60) + "\n\n");

      console.log(`📝 Log file created (${mode}): ${this.logFilePath}`);
    } catch (error) {
      console.error("Failed to initialize log file:", error);
    }
  }

  private writeToFile(message: string): void {
    if (this.logStream) {
      this.logStream.write(message);
    }
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
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
    this.info(`🤖 Bot is ready! Logged in as ${tag}`);
  }

  commandRefresh(): void {
    this.info('🔄 Refreshing application commands...');
  }

  commandRefreshSuccess(): void {
    this.info('✅ Application commands loaded successfully!');
  }

  serverNotRegistered(): void {
    this.warn("🚫 Server not registered in database");
  }

  reconnectionFailed(error: any): void {
    this.error("🔌 Voice connection reconnection failed:", error);
  }

  messageDeleteFailed(id: string, error: any): void {
    this.error(`🗑️ Failed to delete message ${id}:`, error);
  }

  unhandledRejection(error: any): void {
    this.error('💥 Unhandled promise rejection:', error);
  }

  httpServerStart(port: number): void {
    this.info(`🌐 HTTP server started on port ${port}`);
  }

  httpServerClose(): void {
    this.info("🌐 HTTP server closed");
  }

  httpError(error: any): void {
    this.error('🌐 HTTP Server Error:', error);
  }

  // 로그 파일 정리 메서드
  cleanup(): void {
    try {
      if (this.logStream) {
        this.writeToFile(`\n=== Juhee Bot Log Ended at ${new Date().toISOString()} ===\n`);
        this.logStream.end();
        this.logStream = null;
      }
    } catch (error) {
      console.error("Failed to cleanup logger:", error);
    }
  }

  // 오래된 로그 파일 정리 (7일 이상)
  cleanupOldLogs(): void {
    try {
      // 현재 모드와 반대 모드 폴더 모두 정리
      const logsFolders = ["logs-dev", "logs-prod"];
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

      logsFolders.forEach(folderName => {
        const logsDir = path.join(process.cwd(), folderName);
        if (!fs.existsSync(logsDir)) return;

        const files = fs.readdirSync(logsDir);
        
        files.forEach(file => {
          if (file.startsWith("juhee-bot_") && file.endsWith(".log")) {
            const filePath = path.join(logsDir, file);
            const stats = fs.statSync(filePath);
            
            if (stats.mtime.getTime() < sevenDaysAgo) {
              fs.unlinkSync(filePath);
              this.info(`🗑️ Deleted old log file: ${folderName}/${file}`);
            }
          }
        });
      });
    } catch (error) {
      this.error("Failed to cleanup old logs:", error);
    }
  }

  // 현재 로그 파일 경로 반환
  getLogFilePath(): string {
    return this.logFilePath;
  }
}

export const logger = new Logger(); 