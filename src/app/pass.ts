import { buildReminder } from "../messages/reminder.js";
import { isDue } from "../state/store.js";
import { parseDuration, describeDuration } from "../time/duration.js";
import { isValidTimeZone, isWithinWorkingHours } from "../time/zones.js";
import { applicableRules, assessUser, buildPopulation } from "./assess.js";
import type { AppDeps } from "./deps.js";

export type PassResult = {
	inScope: number;
	due: number;
	checked: number;
	incomplete: number;
	reminded: number;
	compliant: number;
	errors: number;
};

export async function runCheckPass(deps: AppDeps): Promise<PassResult> {
	const { dir, store, config, rules, log, now } = deps;
	const users = await dir.listUsers();
	const population = buildPopulation(users, config, rules);
	const everyMs = parseDuration(config.reminders.every);
	const everyText = describeDuration(config.reminders.every);

	const result: PassResult = {
		inScope: population.inScope.length,
		due: 0,
		checked: 0,
		incomplete: 0,
		reminded: 0,
		compliant: 0,
		errors: 0,
	};

	for (const user of population.inScope) {
		const applicable = applicableRules(user.id, rules, population.ruleScopes);
		if (applicable.length === 0) {
			continue;
		}
		const at = now();
		if (!isDue(store.get(user.id), at, everyMs)) {
			continue;
		}
		const wh = config.reminders.working_hours;
		if (wh !== undefined) {
			const tz =
				user.tz !== undefined && isValidTimeZone(user.tz)
					? user.tz
					: config.schedule.timezone;
			if (!isWithinWorkingHours(at, tz, wh)) {
				continue;
			}
		}
		result.due++;
		try {
			const failures = await assessUser(user, applicable, dir);
			result.checked++;
			if (failures.length > 0) {
				result.incomplete++;
				if (!config.dry_run) {
					const state = store.get(user.id);
					const channel = state?.dmChannelId ?? (await dir.openDm(user.id));
					const msg = buildReminder({
						firstName: user.firstName,
						failures,
						messages: config.messages,
						every: everyText,
					});
					const { ts } = await dir.postMessage(channel, msg);
					store.recordReminder(user.id, {
						at,
						dmChannelId: channel,
						messageTs: ts,
						failures: failures.map((f) => f.ruleId),
					});
					result.reminded++;
				}
			} else {
				store.markCompliant(user.id, at);
				result.compliant++;
			}
		} catch (err) {
			result.errors++;
			log.warn(
				{
					userId: user.id,
					err: err instanceof Error ? err.message : String(err),
				},
				"check pass: could not assess person",
			);
		}
	}

	log.info(result, "check pass finished");
	return result;
}
