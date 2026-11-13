import { describe, expect, it } from "vitest";
import type { AppDeps } from "../../src/app/deps.js";
import { runAdminReport, summarizeCompliance } from "../../src/app/report.js";
import { parseConfigText } from "../../src/config/load.js";
import { prepareRules } from "../../src/rules/prepare.js";
import { openStateStore } from "../../src/state/store.js";
import { FakeSlackDirectory, makeUser } from "../support/fake-directory.js";
import { spyLogger } from "../support/spy-logger.js";

const RULES_YAML = `rules:
  - id: photo
    field: photo
    check: required
    hint: Upload a photo.
  - id: phone
    field: phone
    check: phone
    hint: Add your mobile.
`;

function setup(yaml: string, fake = new FakeSlackDirectory()) {
	const config = parseConfigText(yaml);
	const { rules } = prepareRules(config.rules, fake.fields);
	const log = spyLogger();
	const deps: AppDeps = {
		dir: fake,
		store: openStateStore(":memory:"),
		config,
		rules,
		log,
		now: () => new Date("2026-11-15T10:00:00Z"), // Sunday
	};
	return { fake, deps, log };
}

const BASE = `dry_run: false\n${RULES_YAML}`;

describe("summarizeCompliance", () => {
	it("summarizes everyone regardless of reminder state or working hours", async () => {
		const { fake, deps } = setup(BASE);
		fake.users = [
			makeUser({ id: "U1" }),
			makeUser({ id: "U2", profile: { hasCustomImage: false } }),
			makeUser({
				id: "U3",
				profile: { hasCustomImage: false, phone: "" },
			}),
		];
		const { summary } = await summarizeCompliance(deps);
		expect(summary).toEqual({
			inScope: 3,
			complete: 1,
			incomplete: [
				{ userId: "U2", failures: ["photo"] },
				{ userId: "U3", failures: ["photo", "phone"] },
			],
			perRule: [
				{ ruleId: "photo", count: 2 },
				{ ruleId: "phone", count: 1 },
			],
		});
	});

	it("a failing assessment is logged and excluded", async () => {
		const yaml = `dry_run: false
rules:
  - id: department
    custom_field: Department
    check: one_of
    values: [Tech]
    hint: Set your Department.
`;
		const fake = new FakeSlackDirectory();
		fake.fields = [
			{
				id: "Xf1",
				label: "Department",
				type: "text",
				possibleValues: [],
				isHidden: false,
				isScim: false,
			},
		];
		const { deps, log } = setup(yaml, fake);
		fake.users = [makeUser({ id: "U1" }), makeUser({ id: "U2" })];
		fake.profiles.set("U1", { Xf1: "Tech" });
		fake.failProfileFor.add("U2");
		const { summary } = await summarizeCompliance(deps);
		expect(summary.inScope).toBe(1);
		expect(summary.complete).toBe(1);
		expect(summary.incomplete).toEqual([]);
		const warn = log.lines.find((l) => l.level === "warn");
		expect(warn?.o).toMatchObject({ userId: "U2" });
	});
});

describe("runAdminReport", () => {
	it("posts to the admin channel with the dry-run label", async () => {
		const yaml = `dry_run: true
admin_report:
  channel: C0ADMIN
  schedule: "0 9 * * 1"
${RULES_YAML}`;
		const { fake, deps } = setup(yaml);
		fake.users = [makeUser({ id: "U1", profile: { hasCustomImage: false } })];
		await runAdminReport(deps);
		expect(fake.posted[0]?.channel).toBe("C0ADMIN");
		expect(JSON.stringify(fake.posted[0]?.msg)).toContain(
			"dry run — nobody was messaged",
		);
	});

	it("no admin_report → posts nothing", async () => {
		const { fake, deps } = setup(BASE);
		fake.users = [makeUser({ id: "U1" })];
		await runAdminReport(deps);
		expect(fake.posted).toEqual([]);
	});

	it("not invited to the channel → logs an invite hint and resolves (Review Focus 4)", async () => {
		const yaml = `dry_run: true
admin_report:
  channel: C0ADMIN
  schedule: "0 9 * * 1"
${RULES_YAML}`;
		const { fake, deps, log } = setup(yaml);
		fake.users = [makeUser({ id: "U1" })];
		fake.postError = { data: { error: "not_in_channel" } };
		await expect(runAdminReport(deps)).resolves.toBeUndefined();
		expect(
			log.lines.some(
				(l) => l.level === "error" && l.msg?.includes("/invite @Profile Check"),
			),
		).toBe(true);
	});
});
