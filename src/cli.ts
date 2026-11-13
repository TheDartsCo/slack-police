import { parseArgs } from "node:util";
import { WebClient } from "@slack/web-api";
import { ConfigError } from "./config/schema.js";
import { readEnv } from "./env.js";
import { createLogger } from "./log.js";
import { formatCheckReport } from "./messages/report.js";
import type { SlackDirectory } from "./slack/types.js";
import { WebSlackDirectory } from "./slack/web-directory.js";
import { bootstrap } from "./app/bootstrap.js";
import { summarizeCompliance } from "./app/report.js";
import { startApp } from "./app/start.js";

const USAGE = "usage: slack-police [start|check|validate]";

export async function main(
	argv: string[],
	vars: NodeJS.ProcessEnv,
	io: { out(s: string): void; err(s: string): void },
	makeDir: (token: string) => SlackDirectory = (token) =>
		new WebSlackDirectory(new WebClient(token)),
): Promise<number> {
	let command: string;
	try {
		const { positionals } = parseArgs({
			args: argv,
			allowPositionals: true,
			strict: false,
		});
		command = positionals[0] ?? "start";
	} catch {
		io.err(USAGE);
		return 2;
	}
	if (command !== "start" && command !== "check" && command !== "validate") {
		io.err(USAGE);
		return 2;
	}

	const log = createLogger(vars.LOG_LEVEL ?? "info");
	try {
		if (command === "validate") {
			const env = readEnv(vars, { requireAppToken: false });
			const { teamName, warnings } = await bootstrap(
				env.configPath,
				makeDir(env.botToken),
			);
			io.out(`Config OK for workspace "${teamName}"`);
			for (const warning of warnings) {
				io.out(`warning: ${warning}`);
			}
			return 0;
		}
		if (command === "check") {
			const env = readEnv(vars, { requireAppToken: false });
			const dir = makeDir(env.botToken);
			const { config, rules } = await bootstrap(env.configPath, dir);
			const { summary, names } = await summarizeCompliance({
				dir,
				config,
				rules,
				log,
				now: () => new Date(),
			});
			io.out(formatCheckReport(summary, names));
			return 0;
		}
		const env = readEnv(vars, { requireAppToken: true });
		const app = await startApp(env, log);
		await new Promise<void>((resolve) => {
			const shutdown = () => {
				void app.stop().finally(resolve);
			};
			process.once("SIGINT", shutdown);
			process.once("SIGTERM", shutdown);
		});
		return 0;
	} catch (err) {
		if (err instanceof ConfigError) {
			for (const problem of err.problems) {
				io.err(`error: ${problem}`);
			}
		} else {
			io.err(`error: ${err instanceof Error ? err.message : String(err)}`);
		}
		return 1;
	}
}