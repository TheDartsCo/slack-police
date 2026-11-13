import { describe, expect, it } from "vitest";
import {
	buildAdminReport,
	type ComplianceSummary,
	formatCheckReport,
} from "../../src/messages/report.js";

const s: ComplianceSummary = {
	inScope: 12,
	complete: 9,
	incomplete: [{ userId: "U1", failures: ["photo", "phone"] }],
	perRule: [
		{ ruleId: "photo", count: 1 },
		{ ruleId: "phone", count: 1 },
	],
};

describe("buildAdminReport", () => {
	it("admin report text", () => {
		const t = JSON.stringify(buildAdminReport(s, { dryRun: true }).blocks);
		for (const part of [
			"*Profile check:* 9 of 12 complete, 1 incomplete",
			"_dry run — nobody was messaged_",
			"• photo: 1",
			"<@U1> — photo, phone",
		])
			expect(t).toContain(part);
	});

	it("truncates the list", () => {
		const big: ComplianceSummary = {
			inScope: 55,
			complete: 0,
			incomplete: Array.from({ length: 55 }, (_, i) => ({
				userId: `U${i}`,
				failures: ["photo"],
			})),
			perRule: [{ ruleId: "photo", count: 55 }],
		};
		const t = JSON.stringify(buildAdminReport(big, { dryRun: false }).blocks);
		expect(t).toContain("…and 5 more");
		expect(t.match(/<@/g)).toHaveLength(50);
	});

	it("nobody incomplete", () => {
		const none: ComplianceSummary = {
			inScope: 3,
			complete: 3,
			incomplete: [],
			perRule: [],
		};
		const t = JSON.stringify(buildAdminReport(none, { dryRun: false }).blocks);
		expect(t).toContain("Everyone's profile is complete 🎉");
		expect(t).not.toContain("dry run — nobody was messaged");
	});
});

describe("formatCheckReport", () => {
	it("check report for stdout", () =>
		expect(formatCheckReport(s, new Map([["U1", "Sara Ali"]]))).toBe(
			"12 people in scope: 9 complete, 1 incomplete\nBy rule: photo 1, phone 1\nIncomplete:\n  Sara Ali (U1) — photo, phone",
		));
});