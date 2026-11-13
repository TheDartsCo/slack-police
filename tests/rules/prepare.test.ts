import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/schema.js";
import type { RuleConfig } from "../../src/config/schema.js";
import { prepareRules } from "../../src/rules/prepare.js";
import type { CustomFieldDef } from "../../src/slack/types.js";

const dept: CustomFieldDef = {
	id: "Xf1",
	label: "Department",
	type: "text",
	possibleValues: [],
	isHidden: false,
	isScim: false,
};

const rule = (o: object) =>
	({
		id: "department",
		custom_field: "Department",
		check: "one_of",
		values: ["Engineering", "Tech"],
		case_sensitive: false,
		hint: "Set your Department to one of: {values}.",
		...o,
	}) as RuleConfig;

const problemsOf = (f: () => unknown) => {
	try {
		f();
	} catch (e) {
		return (e as ConfigError).problems;
	}
	throw new Error("did not throw");
};

describe("prepareRules", () => {
	it("resolves label case-insensitively and expands {values}", () => {
		const { rules } = prepareRules(
			[rule({ custom_field: " department " })],
			[dept],
		);
		expect(rules[0]).toMatchObject({
			target: { kind: "custom", fieldId: "Xf1", label: "Department" },
			hint: "Set your Department to one of: Engineering, Tech.",
		});
	});

	it("unknown label lists available labels", () =>
		expect(
			problemsOf(() => prepareRules([rule({ custom_field: "Dept" })], [dept])),
		).toEqual([
			'rules[0].custom_field: no custom profile field labelled "Dept". Available: Department',
		]));

	it("no custom fields at all → paid-plan message", () =>
		expect(problemsOf(() => prepareRules([rule({})], []))).toEqual([
			"rules[0].custom_field: this workspace has no custom profile fields (they need a paid Slack plan)",
		]));

	it("text field one_of without values is an error", () =>
		expect(
			problemsOf(() => prepareRules([rule({ values: undefined })], [dept])),
		).toEqual([
			'rules[0].values: required unless "Department" is a dropdown (options list) field',
		]));

	it("options_list without values uses possible_values", () => {
		const f = { ...dept, type: "options_list", possibleValues: ["Eng", "Ops"] };
		expect(prepareRules([rule({ values: undefined })], [f]).rules[0]?.check).toEqual(
			{ check: "one_of", values: ["Eng", "Ops"], case_sensitive: false },
		);
	});

	it("warnings: SCIM, hidden, value not an option", () => {
		const f = {
			...dept,
			type: "options_list",
			possibleValues: ["Engineering"],
			isScim: true,
			isHidden: true,
		};
		expect(prepareRules([rule({})], [f]).warnings).toEqual([
			`rule "department": "Department" is synced from your identity provider (SCIM); people usually can't edit it in Slack`,
			'rule "department": "Department" is hidden in Slack profiles',
			'rule "department": "Tech" is not one of the field\'s options (Engineering)',
		]);
	});
});