import { buildAllDone, buildStillMissing } from "../messages/reminder.js";
import { describeDuration } from "../time/duration.js";
import { applicableRules, assessUser, buildPopulation } from "./assess.js";
import type { AppDeps } from "./deps.js";

export type CheckAgainOutcome = "all_done" | "still_missing" | "debounced";

export function createCheckAgainHandler(
	deps: AppDeps,
	debounceMs = 10_000,
): (a: {
	userId: string;
	channel: string;
	ts: string;
}) => Promise<CheckAgainOutcome> {
	const lastProcessed = new Map<string, number>();

	return async ({ userId, channel, ts }) => {
		const now = deps.now();
		const prev = lastProcessed.get(userId);
		if (prev !== undefined && now.getTime() - prev < debounceMs) {
			return "debounced";
		}
		lastProcessed.set(userId, now.getTime());

		const user = await deps.dir.getUser(userId);
		const population = buildPopulation([user], deps.config, deps.rules);
		const applicable =
			population.inScope.length > 0
				? applicableRules(userId, deps.rules, population.ruleScopes)
				: [];
		const failures =
			applicable.length > 0 ? await assessUser(user, applicable, deps.dir) : [];

		if (failures.length === 0) {
			await deps.dir.updateMessage(
				channel,
				ts,
				buildAllDone(deps.config.messages),
			);
			deps.store.markCompliant(userId, now);
			return "all_done";
		}

		await deps.dir.updateMessage(
			channel,
			ts,
			buildStillMissing({
				firstName: user.firstName,
				failures,
				messages: deps.config.messages,
				every: describeDuration(deps.config.reminders.every),
			}),
		);
		return "still_missing";
	};
}
