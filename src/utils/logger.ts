const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const GRAY = "\x1b[90m";

type LogLevel = "log" | "error" | "warn" | "info";

const LEVELS: Record<LogLevel, string> = {
	error: `${RED}${BOLD}[ERROR]${RESET}`,
	warn: `${YELLOW}${BOLD}[WARN]${RESET}`,
	info: `${BLUE}${BOLD}[INFO]${RESET}`,
	log: `${GREEN}${BOLD}[LOG]${RESET}`,
};

export function logs(level: LogLevel, ...args: unknown[]) {
	const timestamp = `[${new Date().toUTCString()}]`;
	const coloredLevel = LEVELS[level];
	console[level](`${coloredLevel} ${GRAY}${timestamp}${RESET}`, ...args);
}
