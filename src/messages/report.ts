import type { KnownBlock } from "@slack/types";
import type { SlackMessage } from "../slack/types.js";

export type ComplianceSummary = {
	inScope: number;
	complete: number;
	incomplete: { userId: string; failures: string[] }[];
	perRule: { ruleId: string; count: number }[];
};

export function buildAdminReport(
	s: ComplianceSummary,
	opts: { dryRun: boolean; maxListed?: number },
): SlackMessage {
	const maxListed = opts.maxListed ?? 50;
	const headline = `*Profile check:* ${s.complete} of ${s.inScope} complete, ${s.incomplete.length} incomplete`;
	const summaryText = opts.dryRun
		? `${headline}\n_dry run — nobody was messaged_`
		: headline;

	const blocks: KnownBlock[] = [
		{ type: "section", text: { type: "mrkdwn", text: summaryText } },
	];

	if (s.perRule.length > 0) {
		blocks.push({
			type: "section",
			text: {
				type: "mrkdwn",
				text: s.perRule.map((r) => `• ${r.ruleId}: ${r.count}`).join("\n"),
			},
		});
	}

	if (s.incomplete.length === 0) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: "Everyone's profile is complete 🎉" },
		});
	} else {
		const listed = s.incomplete.slice(0, maxListed);
		const lines = listed.map(
			(p) => `<@${p.userId}> — ${p.failures.join(", ")}`,
		);
		const remaining = s.incomplete.length - listed.length;
		if (remaining > 0) {
			lines.push(`…and ${remaining} more`);
		}
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: lines.join("\n") },
		});
	}

	return { text: headline, blocks };
}

export function formatCheckReport(
	s: ComplianceSummary,
	names: Map<string, string>,
): string {
	const lines = [
		`${s.inScope} people in scope: ${s.complete} complete, ${s.incomplete.length} incomplete`,
		`By rule: ${s.perRule.map((r) => `${r.ruleId} ${r.count}`).join(", ")}`,
	];
	if (s.incomplete.length > 0) {
		lines.push("Incomplete:");
		for (const p of s.incomplete) {
			const name = names.get(p.userId) ?? p.userId;
			lines.push(`  ${name} (${p.userId}) — ${p.failures.join(", ")}`);
		}
	}
	return lines.join("\n");
}