import { describe, expect, it } from "vitest";
import { createCheckAgainHandler } from "../../src/app/check-again.js";
import type { AppDeps } from "../../src/app/deps.js";
import { parseConfigText } from "../../src/config/load.js";
import { prepareRules } from "../../src/rules/prepare.js";
import { openStateStore } from "../../src/state/store.js";
import { FakeSlackDirectory, makeUser } from "../support/fake-directory.js";
import { spyLogger } from "../support/spy-logger.js";

const T0 = new Date("2026-11-12T10:00:00Z");

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

function setup(yaml: string) {
	const fake = new FakeSlackDirectory();
	const config = parseConfigText(yaml);
	const { rules } = prepareRules(config.rules, fake.fields);
	const store = openStateStore(":memory:");
	let now = new Date(T0);
	const deps: AppDeps = {
		dir: fake,
		store,
		config,
		rules,
		log: spyLogger(),
		now: () => now,
	};
	return {
		fake,
		store,
		deps,
		plus: (ms: number) => {
			now = new Date(now.getTime() + ms);
		},
	};
}

const BASE = `dry_run: false\n${RULES_YAML}`;

describe("createCheckAgainHandler", () => {
	it("still missing → updates the clicked message, reminder timing unchanged", async () => {
		const { fake, store, deps } = setup(BASE);
		fake.users = [makeUser({ id: "U1", profile: { phone: "" } })];
		store.recordReminder("U1", {
			at: T0,
			dmChannelId: "DU1",
			messageTs: "1.0",
			failures: ["phone"],
		});
		const handler = createCheckAgainHandler(deps);
		const outcome = await handler({ userId: "U1", channel: "DU1", ts: "1.0" });
		expect(outcome).toBe("still_missing");
		expect(fake.updated[0]).toMatchObject({ channel: "DU1", ts: "1.0" });
		expect(JSON.stringify(fake.updated[0]?.msg)).toContain("Checked just now");
		expect(store.get("U1")).toMatchObject({
			lastRemindedAt: T0.getTime(),
			reminderCount: 1,
		});
	});

	it("fixed → all done and compliant", async () => {
		const { fake, store, deps } = setup(BASE);
		fake.users = [makeUser({ id: "U1" })];
		store.recordReminder("U1", {
			at: T0,
			dmChannelId: "DU1",
			messageTs: "1.0",
			failures: ["phone"],
		});
		const handler = createCheckAgainHandler(deps);
		const outcome = await handler({ userId: "U1", channel: "DU1", ts: "1.0" });
		expect(outcome).toBe("all_done");
		expect(fake.updated[0]?.msg.text).toBe(
			"✅ All set. Thanks for completing your profile!",
		);
		expect(store.get("U1")?.reminderCount).toBe(0);
	});

	it("debounces clicks within 10 s", async () => {
		const { fake, deps, plus } = setup(BASE);
		fake.users = [makeUser({ id: "U1" })];
		const handler = createCheckAgainHandler(deps);
		expect(await handler({ userId: "U1", channel: "DU1", ts: "1.0" })).toBe(
			"all_done",
		);
		plus(5_000);
		expect(await handler({ userId: "U1", channel: "DU1", ts: "1.0" })).toBe(
			"debounced",
		);
		expect(fake.getUserCalls).toEqual(["U1"]);
		plus(6_000);
		expect(await handler({ userId: "U1", channel: "DU1", ts: "1.0" })).toBe(
			"all_done",
		);
		expect(fake.getUserCalls).toEqual(["U1", "U1"]);
	});

	it("person excluded by a config change → all done, no profile fetch (Review Focus 5)", async () => {
		const yaml = `dry_run: false
scope:
  exclude_users: [U1]
${RULES_YAML}`;
		const { fake, deps } = setup(yaml);
		fake.users = [makeUser({ id: "U1", profile: { phone: "" } })];
		const handler = createCheckAgainHandler(deps);
		const outcome = await handler({ userId: "U1", channel: "DU1", ts: "1.0" });
		expect(outcome).toBe("all_done");
		expect(fake.getProfileCalls).toEqual([]);
	});
});