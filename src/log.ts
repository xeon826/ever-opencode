/** Once-only stderr logging, gated by log level. */

export type LogLevel = "debug" | "info" | "error" | "silent";

const order: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  error: 30,
  silent: 99,
};

export class Logger {
  private readonly threshold: number;
  private readonly seen = new Set<string>();

  constructor(level: LogLevel = "info") {
    this.threshold = order[level] ?? order.info;
  }

  private emit(level: Exclude<LogLevel, "silent">, key: string, message: string): void {
    if (order[level] < this.threshold) return;
    if (level === "info" || level === "error") {
      // once-only latch for info/error notices (e.g. degraded latch)
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    process.stderr.write(`[everos-opencode] ${message}\n`);
  }

  debug(message: string): void {
    this.emit("debug", `debug:${message}`, message);
  }

  info(key: string, message: string): void {
    this.emit("info", key, message);
  }

  error(key: string, message: string): void {
    this.emit("error", key, message);
  }
}
