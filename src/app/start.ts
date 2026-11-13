import { join } from "node:path";
import { App } from "@slack/bolt";
import { Cron } from "croner";
import type { Env } from "../env.js";
import { startHealthServer } from "../health.js";
import type { Logger } from "../log.js";
import { CHECK_AGAIN_ACTION_ID } from "../messages/reminder.js";
import { openStateStore } from "../state/store.js";
import { WebSlackDirectory } from "../slack/web-directory.js";
import { bootstrap } from "./bootstrap.js";
import { createCheckAgainHandler } from "./check-again.js";
import type { AppDeps } from "./deps.js";
import { runCheckPass, type PassResult } from "./pass.js";
import { runAdminReport } from "./report.js";

export async function startApp(
	env: Env,
	log: Logger,
): Promise<{ stop(): Promise<void> }> {
	const app = new App({
		token: env.botToken,
		appToken: env.appToken,
		socketMode: true,
	});
	const dir = new WebSlackDirectory(app.client);
	const { config, rules, teamName, warnings } = await bootstrap(
		env.configPath,
		dir,
	);
	log.info({ teamName }, "connected to workspace");
	for (const warning of warnings) {
		log.warn({}, warning);
	}

	const store = openStateStore(join(env.dataDir, "state.db"));
	const deps: AppDeps = {
		dir,
		store,
		config,
		rules,
		log,
		now: () => new Date(),
	};
	const checkAgain = createCheckAgainHandler(deps);

	app.action(CHECK_AGAIN_ACTION_ID, async ({ ack, body }) => {
		await ack();
		const b = body as unknown as {
			user: { id: string };
			channel: { id: string };
			message: { ts: string };
		};
		try {
			await checkAgain({
				userId: b.user.id,
				channel: b.channel.id,
				ts: b.message.ts,
			});
		} catch (err) {
			log.error(
				{ err: err instanceof Error ? err.message : String(err) },
				"check again failed",
			);
		}
	});

	await app.start();

	let lastPass: PassResult | undefined;
	const jobs: Cron[] = [
		new Cron(
			config.schedule.check,
			{ timezone: config.schedule.timezone, protect: true, catch: true },
			() => {
				runCheckPass(deps)
					.then((result) => {
						lastPass = result;
					})
					.catch((err: unknown) => {
						log.error(
							{ err: err instanceof Error ? err.message : String(err) },
							"check pass failed",
						);
					});
			},
		),
	];
	if (config.admin_report !== undefined) {
		jobs.push(
			new Cron(
				config.admin_report.schedule,
				{ timezone: config.schedule.timezone, protect: true, catch: true },
				() => {
					runAdminReport(deps).catch((err: unknown) => {
						log.error(
							{ err: err instanceof Error ? err.message : String(err) },
							"admin report failed",
						);
					});
				},
			),
		);
	}
	for (const job of jobs) {
		log.info({ nextRun: job.nextRun()?.toISOString() }, "schedule started");
	}

	const server =
		env.healthPort !== undefined
			? startHealthServer(env.healthPort, () => ({ ok: true, lastPass }))
			: undefined;

	return {
		async stop() {
			for (const job of jobs) {
				job.stop();
			}
			await app.stop();
			server?.close();
			store.close();
		},
	};
}
