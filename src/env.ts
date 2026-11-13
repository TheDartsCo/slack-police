export type Env = {
	botToken: string;
	appToken: string | undefined;
	configPath: string;
	dataDir: string;
	logLevel: string;
	healthPort: number | undefined;
};

export function readEnv(
	vars: NodeJS.ProcessEnv,
	opts: { requireAppToken: boolean },
): Env {
	const botToken = vars.SLACK_BOT_TOKEN;
	if (botToken === undefined || botToken === "") {
		throw new Error("SLACK_BOT_TOKEN is not set (it starts with xoxb-)");
	}
	if (!botToken.startsWith("xoxb-")) {
		throw new Error("SLACK_BOT_TOKEN should start with xoxb-");
	}
	const appToken = vars.SLACK_APP_TOKEN;
	if (opts.requireAppToken) {
		if (appToken === undefined || appToken === "") {
			throw new Error("SLACK_APP_TOKEN is not set (it starts with xapp-)");
		}
		if (!appToken.startsWith("xapp-")) {
			throw new Error("SLACK_APP_TOKEN should start with xapp-");
		}
	}
	let healthPort: number | undefined;
	if (vars.HEALTH_PORT !== undefined) {
		const port = Number(vars.HEALTH_PORT);
		if (!Number.isInteger(port) || port < 0 || port > 65535) {
			throw new Error("HEALTH_PORT must be a port number");
		}
		healthPort = port;
	}
	return {
		botToken,
		appToken,
		configPath: vars.CONFIG_PATH ?? "./config.yaml",
		dataDir: vars.DATA_DIR ?? "./data",
		logLevel: vars.LOG_LEVEL ?? "info",
		healthPort,
	};
}
