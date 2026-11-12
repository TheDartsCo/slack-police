import { expect, it } from "vitest";
import { type ResolvedCheck, runCheck } from "../../src/rules/checks.js";

const phone = (o = {}) =>
	({
		check: "phone",
		validation: "possible",
		mobile_only: false,
		strict_e164: false,
		...o,
	}) as const;
it.each([
	[true, true],
	[false, false],
	[undefined, false],
	["  ", false],
	["x", true],
])("required(%s) → %s", (v, ok) =>
	expect(runCheck({ check: "required" }, v)).toBe(ok),
);
it.each([
	["+971 50 123 4567", true],
	["+971501234567", true],
	["+971-50-123-4567", true],
	["+971 (50) 123-4567", true],
	[" +971501234567 ", true],
	["0501234567", false],
	["00971 50 123 4567", false],
	["", false],
	["call me", false],
	["+12", false],
])("phone default %s → %s (Review Focus 2)", (v, ok) =>
	expect(runCheck(phone(), v)).toBe(ok),
);
it("strict_e164", () => {
	expect(runCheck(phone({ strict_e164: true }), "+971501234567")).toBe(true);
	expect(runCheck(phone({ strict_e164: true }), "+971 50 123 4567")).toBe(
		false,
	);
});
// '+1 123 456 7890' should be possible but not valid. If libphonenumber disagrees, substitute any number
// with isPossible() && !isValid() and keep both assertions.
it("possible vs valid", () => {
	expect(runCheck(phone(), "+1 123 456 7890")).toBe(true);
	expect(runCheck(phone({ validation: "valid" }), "+1 123 456 7890")).toBe(
		false,
	);
});
it("mobile_only rejects only identified landlines", () => {
	expect(runCheck(phone({ mobile_only: true }), "+971 50 123 4567")).toBe(true); // UAE mobile
	expect(runCheck(phone({ mobile_only: true }), "+971 2 234 5678")).toBe(false); // UAE fixed line
	expect(runCheck(phone(), "+971 2 234 5678")).toBe(true);
	expect(runCheck(phone({ mobile_only: true }), "+1 201 555 0123")).toBe(true); // FIXED_LINE_OR_MOBILE
});
const oneOf = (o = {}): ResolvedCheck => ({
	check: "one_of",
	values: ["Engineering", "Tech"],
	case_sensitive: false,
	...o,
});
it.each([
	["Engineering", true],
	["engineering ", true],
	["Sales", false],
	["", false],
	[undefined, false],
])("one_of %s → %s", (v, ok) => expect(runCheck(oneOf(), v)).toBe(ok));
it("one_of case_sensitive", () =>
	expect(runCheck(oneOf({ case_sensitive: true }), "engineering")).toBe(false));
it("regex", () => {
	const r = { check: "regex", pattern: "^[A-Z]" } as const;
	expect(runCheck(r, "Alice")).toBe(true);
	expect(runCheck(r, "alice")).toBe(false);
	expect(runCheck(r, undefined)).toBe(false);
});
it("string checks fail on booleans", () =>
	expect(runCheck(oneOf(), true)).toBe(false));
