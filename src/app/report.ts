import {
	buildAdminReport,
	type ComplianceSummary,
} from "../messages/report.js";
import { slackErrorCode } from "../slack/errors.js";
import { applicableRules, assessUser, buildPopulation } from "./assess.js";
import type { AppDeps } from "./deps.js";

export async function summarizeCompliance(
	deps: Omit<AppDeps, "store">,
): Promise<{ summary: ComplianceSummary; names: Map<string, string> }> {
	const { dir, config, rules, log } = deps;
	const users = await dir.listUsers();
	const population = buildPopulation(users, config, rules);

	const counts = new Map<string, number>(rules.map((r) => [r.id, 0]));
	const incomplete: { userId: string; failures: string[] }[] = [];
	const names = new Map<string, string>();
	let inScope = 0;
	let complete = 0;

	for (const user of population.inScope) {
		const applicable = applicableRules(user.id, rules, population.ruleScopes);
		try {
			const failures = await assessUser(user, applicable, dir);
			inScope++;
			names.set(
				user.id,
				user.profile.realName || user.profile.displayName || user.id,
			);
			if (failures.length === 0) {
				complete++;
			} else {
				const ids = failures.map((f) => f.ruleId);
				incomplete.push({ userId: user.id, failures: ids });
				for (const id of ids) {
					counts.set(id, (counts.get(id) ?? 0) + 1);
				}
			}
		} catch (err) {
			log.warn(
				{
					userId: user.id,
					err: err instanceof Error ? err.message : String(err),
				},
				"admin report: could not assess person",
			);
		}
	}

	return {
		summary: {
			inScope,
			complete,
			incomplete,
			perRule: rules.map((r) => ({
				ruleId: r.id,
				count: counts.get(r.id) ?? 0,
			})),
		},
		names,
	};
}

export async function runAdminReport(deps: AppDeps): Promise<void> {
	const report = deps.config.admin_report;
	if (report === undefined) {
		return;
	}
	try {
		const { summary } = await summarizeCompliance(deps);
		await deps.dir.postMessage(
			report.channel,
			buildAdminReport(summary, { dryRun: deps.config.dry_run }),
		);
	} catch (err) {
		const code = slackErrorCode(err);
		if (code === "not_in_channel" || code === "channel_not_found") {
			deps.log.error(
				{ channel: report.channel },
				"invite Profile Check to the admin channel: /invite @Profile Check",
			);
		} else {
			deps.log.error(
				{ err: err instanceof Error ? err.message : String(err) },
				"admin report failed",
			);
		}
	}
}
