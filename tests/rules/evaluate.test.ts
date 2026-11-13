import { describe, expect, it } from "vitest";
import {
	evaluateRules,
	fieldValue,
	needsProfileFetch,
	type PreparedRule,
} from "../../src/rules/evaluate.js";
import { makeUser } from "../support/fake-directory.js";

const photoRule: PreparedRule = {
	id: "photo",
	hint: "Upload a photo.",
	target: { kind: "builtin", field: "photo" },
	check: { check: "required" },
	onlyUsers: undefined,
	excludeUsers: undefined,
};

const phoneRule: PreparedRule = {
	id: "phone",
	hint: "Add your mobile.",
	target: { kind: "builtin", field: "phone" },
	check: {
		check: "phone",
		validation: "possible",
		mobile_only: false,
		strict_e164: false,
	},
	onlyUsers: undefined,
	excludeUsers: undefined,
};

const customRule: PreparedRule = {
	id: "department",
	hint: "Set your Department.",
	target: { kind: "custom", fieldId: "Xf1", label: "Department" },
	check: { check: "one_of", values: ["Tech"], case_sensitive: false },
	onlyUsers: undefined,
	excludeUsers: undefined,
};

describe("fieldValue", () => {
	it("maps built-ins and custom fields", () => {
		const profile = {
			...makeUser({ id: "U1" }).profile,
			hasCustomImage: false,
			phone: "+971501234567",
			displayName: "sara",
			customFields: { Xf1: "Tech" },
		};
		expect(fieldValue(profile, { kind: "builtin", field: "photo" })).toBe(
			false,
		);
		expect(fieldValue(profile, { kind: "builtin", field: "phone" })).toBe(
			"+971501234567",
		);
		expect(
			fieldValue(profile, { kind: "builtin", field: "display_name" }),
		).toBe("sara");
		expect(
			fieldValue(profile, {
				kind: "custom",
				fieldId: "Xf1",
				label: "Department",
			}),
		).toBe("Tech");
		expect(
			fieldValue(profile, { kind: "custom", fieldId: "Xf9", label: "Missing" }),
		).toBeUndefined();
	});
});

describe("needsProfileFetch", () => {
	it("custom rule → true", () => {
		const profile = makeUser({ id: "U1" }).profile;
		expect(needsProfileFetch([customRule], profile)).toBe(true);
	});

	it("photo rule with hasCustomImage undefined → true", () => {
		const profile = {
			...makeUser({ id: "U1" }).profile,
			hasCustomImage: undefined,
		};
		expect(needsProfileFetch([photoRule], profile)).toBe(true);
	});

	it("built-ins otherwise → false", () => {
		const profile = makeUser({ id: "U1" }).profile;
		expect(needsProfileFetch([photoRule, phoneRule], profile)).toBe(false);
	});
});

describe("evaluateRules", () => {
	it("returns failures in rule order with hints", () => {
		const profile = {
			...makeUser({ id: "U1" }).profile,
			hasCustomImage: false,
			phone: "",
		};
		expect(evaluateRules(profile, [photoRule, phoneRule])).toEqual([
			{ ruleId: "photo", hint: "Upload a photo." },
			{ ruleId: "phone", hint: "Add your mobile." },
		]);
	});

	it("returns no failures when everything passes", () => {
		const profile = makeUser({ id: "U1" }).profile;
		expect(evaluateRules(profile, [photoRule, phoneRule])).toEqual([]);
	});
});
