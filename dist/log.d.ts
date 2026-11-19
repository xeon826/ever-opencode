/** Once-only stderr logging, gated by log level. */
export type LogLevel = "debug" | "info" | "error" | "silent";
export declare class Logger {
    private readonly threshold;
    private readonly seen;
    constructor(level?: LogLevel);
    private emit;
    debug(message: string): void;
    info(key: string, message: string): void;
    error(key: string, message: string): void;
}
