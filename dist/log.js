/** Once-only stderr logging, gated by log level. */
const order = {
    debug: 10,
    info: 20,
    error: 30,
    silent: 99,
};
export class Logger {
    threshold;
    seen = new Set();
    constructor(level = "info") {
        this.threshold = order[level] ?? order.info;
    }
    emit(level, key, message) {
        if (order[level] < this.threshold)
            return;
        if (level === "info" || level === "error") {
            // once-only latch for info/error notices (e.g. degraded latch)
            if (this.seen.has(key))
                return;
            this.seen.add(key);
        }
        process.stderr.write(`[everos-opencode] ${message}\n`);
    }
    debug(message) {
        this.emit("debug", `debug:${message}`, message);
    }
    info(key, message) {
        this.emit("info", key, message);
    }
    error(key, message) {
        this.emit("error", key, message);
    }
}
