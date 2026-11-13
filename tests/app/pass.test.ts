import { describe, expect, it } from "vitest";
import type { AppDeps } from "../../src/app/deps.js";
import { runCheckPass } from "../../src/app/pass.js";
import { parseConfigText } from "../../src/config/load.js";
import type { Config } from "../../src/config/schema.js";
import { prepareRules } from "../../src/rules/prepare.js";
import { openStateStore } from "../../src/state/store.js";
import {
	FakeSlackDirectory,
	makeUser,
} from "../support/fake-directory.js";
import { spyLogger } from "../support/spy-logger.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = new Date("2026-11-12T10:00:00Z"); // Thursday, 14:00 in Dubai

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
	const store = openStateStore(":memory:");
	const log = spyLogger();
	let now = new Date(T0);
	const deps: AppDeps = {
		dir: fake,
		store,
		config,
		rules,
		log,
		now: () => now,
	};
	return {
		fake,
		config,
		store,
		log,
		deps,
		plus: (ms: number) => {
			now = new Date(now.getTime() + ms);
		},
	};
}

const BASE = `dry_run: false\n${RULES_YAML}`;

describe("runCheckPass", () => {
	it("DMs a person missing a photo once, then not again until the gap passes", async () => {
		const { fake, deps, plus } = setup(BASE);
		fake.users = [makeUser({ id: "U1", profile: { hasCustomImage: false } })];
		await runCheckPass(deps);
		plus(HOUR);
		await runCheckPass(deps);
		expect(fake.posted).toHaveLength(1);
		expect(fake.posted[0]?.channel).toBe("DU1");
		plus(7 * DAY);
		await runCheckPass(deps);
		expect(fake.posted).toHaveLength(2);
		expect(fake.openDmCalls).toEqual(["U1"]);
	});

	it("dry_run sends nothing and records nothing", async () => {
		const { fake, deps, store } = setup(`dry_run: true\n${RULES_YAML}`);
		fake.users = [makeUser({ id: "U1", profile: { hasCustomImage: false } })];
		const result = await runCheckPass(deps);
		expect(fake.posted).toEqual([]);
		expect(fake.openDmCalls).toEqual([]);
		expect(store.get("U1")).toBeUndefined();
		expect(result.incomplete).toBe(1);
	});

	it("marks compliant people", async () => {
		const { fake, deps, store } = setup(BASE);
		fake.users = [makeUser({ id: "U1" })];
		const result = await runCheckPass(deps);
		expect(result.compliant).toBe(1);
		expect(store.get("U1")?.reminderCount).toBe(0);
	});

	it("skips people outside their own working hours", async () => {
		const yaml = `dry_run: false
reminders:
  working_hours:
    start: "09:00"
    end: "17:00"
    days: [mon, tue, wed, thu, fri]
${RULES_YAML}`;
		const { fake, deps } = setup(yaml);
		fake.users = [
			makeUser({ id: "U1", tz: "Asia/Dubai", profile: { hasCustomImage: false } }),
		];
		// Saturday in Dubai
		const saturday = setup(yaml, fake);
		saturday.deps.now = () => new Date("2026-11-14T10:00:00Z");
		const result = await runCheckPass(saturday.deps);
		expect(result.due).toBe(0);
		expect(fake.posted).toEqual([]);
	});

	it.each([undefined, "Not/AZone"])(
		"falls back to schedule.timezone when tz is %s (Review Focus 1)",
		async (tz) => {
			const yaml = `dry_run: false
schedule:
  timezone: UTC
reminders:
  working_hours:
    start: "09:00"
    end: "17:00"
    days: [mon, tue, wed, thu, fri]
${RULES_YAML}`;
			const { fake, deps } = setup(yaml);
			fake.users = [
				makeUser({ id: "U1", tz, profile: { hasCustomImage: false } }),
			];
			const result = await runCheckPass(deps);
			expect(result.reminded).toBe(1);
		},
	);

	it("fetches profiles only for due people who need them", async () => {
		const { fake, deps } = setup(BASE);
		fake.users = [makeUser({ id: "U1" })];
		await runCheckPass(deps);
		expect(fake.getProfileCalls).toEqual([]);

		const customYaml = `dry_run: false
rules:
  - id: department
    custom_field: Department
    check: one_of
    values: [Tech]
    hint: Set your Department.
`;
		const fake2 = new FakeSlackDirectory();
		fake2.fields = [
			{
				id: "Xf1",
				label: "Department",
				type: "text",
				possibleValues: [],
				isHidden: false,
				isScim: false,
			},
		];
		const s = setup(customYaml, fake2);
		fake2.users = [makeUser({ id: "U1" }), makeUser({ id: "U2" })];
		fake2.profiles.set("U1", { Xf1: "Tech" });
		fake2.profiles.set("U2", { Xf1: "Tech" });
		s.store.recordReminder("U1", {
			at: new Date(T0.getTime() - DAY),
			dmChannelId: "DU1",
			messageTs: "1.0",
			failures: ["department"],
		});
		await runCheckPass(s.deps);
		expect(fake2.getProfileCalls).toEqual(["U2"]);
	});

	it("photo rule fetches the profile when users.list omitted is_custom_image", async () => {
		const { fake, deps } = setup(BASE);
		fake.users = [
			makeUser({ id: "U1", profile: { hasCustomImage: undefined } }),
		];
		await runCheckPass(deps);
		expect(fake.getProfileCalls).toEqual(["U1"]);
	});

	it("a rule's only_users never re-includes someone excluded globally", async () => {
		const yaml = `dry_run: false
scope:
  exclude_users: [U1]
rules:
  - id: photo
    field: photo
    check: required
    hint: Upload a photo.
    only_users: [U1]
`;
		const { fake, deps } = setup(yaml);
		fake.users = [makeUser({ id: "U1", profile: { hasCustomImage: false } })];
		await runCheckPass(deps);
		expect(fake.posted).toEqual([]);
		expect(fake.getProfileCalls).toEqual([]);
	});

	it("skips bots, deactivated, invited, Slack Connect people and guests by default", async () => {
		const { fake, deps } = setup(BASE);
		fake.users = [
			makeUser({ id: "U1", isBot: true }),
			makeUser({ id: "U2", deleted: true }),
			makeUser({ id: "U3", isInvitedUser: true }),
			makeUser({ id: "U4", isStranger: true }),
			makeUser({ id: "U5", isRestricted: true }),
		];
		const result = await runCheckPass(deps);
		expect(result.inScope).toBe(0);
	});

	it("people with no applicable rules are neither fetched nor messaged", async () => {
		const yaml = `dry_run: false
rules:
  - id: photo
    field: photo
    check: required
    hint: Upload a photo.
    only_users: [U2]
`;
		const { fake, deps, store } = setup(yaml);
		fake.users = [makeUser({ id: "U1", profile: { hasCustomImage: false } })];
		await runCheckPass(deps);
		expect(fake.posted).toEqual([]);
		expect(fake.getProfileCalls).toEqual([]);
		expect(store.get("U1")).toBeUndefined();
	});

	it("one person's API error doesn't stop the pass", async () => {
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
		fake.profiles.set("U2", { Xf1: "Sales" });
		fake.failProfileFor.add("U1");
		const result = await runCheckPass(deps);
		expect(result.errors).toBe(1);
		expect(fake.posted.map((p) => p.channel)).toEqual(["DU2"]);
		const warn = log.lines.find((l) => l.level === "warn");
		expect(warn?.o).toMatchObject({ userId: "U1" });
		expect(JSON.stringify(log.lines)).not.toContain("Sales");
	});

	it("logs a summary without field values", async () => {
		const { fake, deps, log } = setup(BASE);
		fake.users = [makeUser({ id: "U1", profile: { hasCustomImage: false } })];
		await runCheckPass(deps);
		const lastInfo = [...log.lines].reverse().find((l) => l.level === "info");
		expect(lastInfo?.msg).toBe("check pass finished");
		expect(JSON.stringify(log.lines)).not.toContain("+971");
	});
});