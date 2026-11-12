import { describe, expect, it } from "vitest";
import {
	isValidTimeZone,
	isWithinWorkingHours,
	localTime,
} from "../../src/time/zones.js";

const wh = {
	start: "09:00",
	end: "17:00",
	days: ["mon", "tue", "wed", "thu", "fri"],
} as const;

describe("isWithinWorkingHours", () => {
	it("Dubai Thursday 09:30 is inside", () =>
		expect(
			isWithinWorkingHours(new Date("2026-11-12T05:30:00Z"), "Asia/Dubai", wh),
		).toBe(true));
	it("Dubai 08:59 is outside", () =>
		expect(
			isWithinWorkingHours(new Date("2026-11-12T04:59:00Z"), "Asia/Dubai", wh),
		).toBe(false));
	it("end is exclusive (17:00)", () =>
		expect(
			isWithinWorkingHours(new Date("2026-11-12T13:00:00Z"), "Asia/Dubai", wh),
		).toBe(false));
	it("Saturday is outside", () =>
		expect(
			isWithinWorkingHours(new Date("2026-11-14T08:00:00Z"), "Asia/Dubai", wh),
		).toBe(false));
	it("LA uses its own date: Thu 17:00 PST", () =>
		expect(
			isWithinWorkingHours(
				new Date("2026-11-13T01:00:00Z"),
				"America/Los_Angeles",
				wh,
			),
		).toBe(false));
	it("LA Thu 09:30 PST", () =>
		expect(
			isWithinWorkingHours(
				new Date("2026-11-12T17:30:00Z"),
				"America/Los_Angeles",
				wh,
			),
		).toBe(true));
	it("London after DST starts (Mon 09:30 BST)", () =>
		expect(
			isWithinWorkingHours(
				new Date("2026-03-30T08:30:00Z"),
				"Europe/London",
				wh,
			),
		).toBe(true));
	it("London before DST (Fri 08:30 GMT)", () =>
		expect(
			isWithinWorkingHours(
				new Date("2026-03-27T08:30:00Z"),
				"Europe/London",
				wh,
			),
		).toBe(false));
});

describe("localTime", () => {
	it("localTime", () =>
		expect(localTime(new Date("2026-11-12T05:30:00Z"), "Asia/Dubai")).toEqual({
			weekday: "thu",
			minutes: 570,
		}));
});

describe("isValidTimeZone", () => {
	it("time zone validity", () => {
		expect(isValidTimeZone("Asia/Dubai")).toBe(true);
		expect(isValidTimeZone("Mars/Base")).toBe(false);
	});
});
