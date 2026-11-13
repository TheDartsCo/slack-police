import pino from "pino";

export type Logger = {
	debug(o: object, msg?: string): void;
	info(o: object, msg?: string): void;
	warn(o: object, msg?: string): void;
	error(o: object, msg?: string): void;
};

export function createLogger(level: string): Logger {
	return pino({ level });
}
