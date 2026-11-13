import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	isDue,
	openStateStore,
	type PersonState,
} from "../../src/state/store.js";

const t0 = new Date("2026-11-12T08:00:00Z");
const DAY = 86_400_000;

describe("StateStore", () => {
	it("fresh store has no row", () =>
		expect(openStateStore(":memory:").get("U1")).toBeUndefined());

	it("recordReminder increments and keeps latest", () => {
		const s = openStateStore(":memory:");
		s.recordReminder("U1", {
			at: t0,
			dmChannelId: "D1",
			messageTs: "1.0",
			failures: ["photo", "phone"],
		});
		s.recordReminder("U1", {
			at: new Date(t0.getTime() + 7 * DAY),
			dmChannelId: "D1",
			messageTs: "2.0",
			failures: ["phone"],
		});
		expect(s.get("U1")).toMatchObject({
			reminderCount: 2,
			lastRemindedAt: t0.getTime() + 7 * DAY,
			lastMessageTs: "2.0",
			lastFailures: ["phone"],
		});
		s.close();
	});

	it("markCompliant resets count, failures and lastRemindedAt but keeps the DM channel", () => {
		const s = openStateStore(":memory:");
		s.recordReminder("U1", {
			at: t0,
			dmChannelId: "D1",
			messageTs: "1.0",
			failures: ["photo"],
		});
		s.markCompliant("U1", new Date(t0.getTime() + DAY));
		expect(s.get("U1")).toMatchObject({
			reminderCount: 0,
			lastFailures: [],
			lastRemindedAt: null,
			dmChannelId: "D1",
		});
		s.close();
	});

	it("markCompliant on an unknown user creates the row", () => {
		const s = openStateStore(":memory:");
		s.markCompliant("U9", t0);
		const row = s.get("U9");
		expect(row).toBeDefined();
		expect(row?.reminderCount).toBe(0);
		s.close();
	});

	it("persists across reopen in a new directory", () => {
		const dir = mkdtempSync(join(tmpdir(), "slack-police-test-"));
		try {
			const path = join(dir, "nested", "state.db");
			const s = openStateStore(path);
			s.recordReminder("U1", {
				at: t0,
				dmChannelId: "D1",
				messageTs: "1.0",
				failures: ["photo"],
			});
			s.close();
			const reopened = openStateStore(path);
			expect(reopened.get("U1")).toMatchObject({
				userId: "U1",
				reminderCount: 1,
				lastRemindedAt: t0.getTime(),
				dmChannelId: "D1",
				lastMessageTs: "1.0",
				lastFailures: ["photo"],
			});
			reopened.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("isDue", () => {
	it.each([
		[undefined, true],
		[{ lastRemindedAt: null }, true],
		[{ lastRemindedAt: t0.getTime() - 7 * DAY + 60_000 }, false],
		[{ lastRemindedAt: t0.getTime() - 7 * DAY }, true],
	])("isDue %#", (st, due) =>
		expect(isDue(st as PersonState | undefined, t0, 7 * DAY)).toBe(due),
	);
});
