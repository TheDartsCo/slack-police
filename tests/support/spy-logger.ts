import type { Logger } from "../../src/log.js";

export function spyLogger(): Logger & {
	lines: { level: string; o: object; msg?: string }[];
} {
	const lines: { level: string; o: object; msg?: string }[] = [];
	const record =
		(level: string) =>
		(o: object, msg?: string): void => {
			lines.push({ level, o, msg });
		};
	return {
		debug: record("debug"),
		info: record("info"),
		warn: record("warn"),
		error: record("error"),
		lines,
	};
}
