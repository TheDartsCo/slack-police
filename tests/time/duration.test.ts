import { describe, expect, it } from "vitest";
import { describeDuration, parseDuration } from "../../src/time/duration.js";

describe("parseDuration", () => {
	it.each([
		["30m", 1_800_000],
		["12h", 43_200_000],
		["7d", 604_800_000],
		["2w", 1_209_600_000],
	])("parseDuration(%s)", (s, ms) => expect(parseDuration(s)).toBe(ms));

	it.each(["7", "d", "0d", "1.5d", " 7d", "7 days"])("rejects %s", (s) =>
		expect(() => parseDuration(s)).toThrow(
			`invalid duration "${s}" (use e.g. 30m, 12h, 7d, 2w)`,
		),
	);
});

describe("describeDuration", () => {
	it.each([
		["7d", "7 days"],
		["1w", "week"],
		["1d", "day"],
		["12h", "12 hours"],
		["30m", "30 minutes"],
		["2w", "2 weeks"],
	])("describeDuration(%s)", (s, text) =>
		expect(describeDuration(s)).toBe(text),
	);
});
