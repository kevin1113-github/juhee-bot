import { LogLevel } from "./LogLevel.js";
/**
 * Defines diagnostics API for managing console output
 * Added in version 1.21.0
 */
export declare class Diagnostics {
    private static privListener;
    static SetLoggingLevel(logLevel: LogLevel): void;
    static StartConsoleOutput(): void;
    static StopConsoleOutput(): void;
    static SetLogOutputPath(path: string): void;
}
