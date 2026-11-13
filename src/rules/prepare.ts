import { ConfigError } from "../config/schema.js";
import type { BuiltinField, RuleConfig } from "../config/schema.js";
import type { CustomFieldDef } from "../slack/types.js";
import type { ResolvedCheck } from "./checks.js";

export type RuleTarget =
	| { kind: "builtin"; field: BuiltinField }
	| { kind: "custom"; fieldId: string; label: string };

export type PreparedRule = {
	id: string;
	hint: string;
	target: RuleTarget;
	check: ResolvedCheck;
	onlyUsers: string[] | undefined;
	excludeUsers: string[] | undefined;
};

export function prepareRules(
	rules: RuleConfig[],
	fields: CustomFieldDef[],
): { rules: PreparedRule[]; warnings: string[] } {
	const problems: string[] = [];
	const warnings: string[] = [];
	const prepared: PreparedRule[] = [];

	rules.forEach((rule, i) => {
		const path = `rules[${i}]`;
		let target: RuleTarget;
		let field: CustomFieldDef | undefined;

		if (rule.custom_field !== undefined) {
			const label = rule.custom_field.trim();
			field = fields.find((f) => f.label.toLowerCase() === label.toLowerCase());
			if (field === undefined) {
				problems.push(
					fields.length === 0
						? `${path}.custom_field: this workspace has no custom profile fields (they need a paid Slack plan)`
						: `${path}.custom_field: no custom profile field labelled "${label}". Available: ${fields.map((f) => f.label).join(", ")}`,
				);
				return;
			}
			target = { kind: "custom", fieldId: field.id, label: field.label };
			if (field.isScim) {
				warnings.push(
					`rule "${rule.id}": "${field.label}" is synced from your identity provider (SCIM); people usually can't edit it in Slack`,
				);
			}
			if (field.isHidden) {
				warnings.push(
					`rule "${rule.id}": "${field.label}" is hidden in Slack profiles`,
				);
			}
		} else {
			target = { kind: "builtin", field: rule.field as BuiltinField };
		}

		let check: ResolvedCheck;
		if (rule.check === "one_of") {
			let values = rule.values;
			if (values === undefined && field?.type === "options_list") {
				values = field.possibleValues;
			}
			if (values === undefined) {
				problems.push(
					`${path}.values: required unless "${field?.label}" is a dropdown (options list) field`,
				);
				return;
			}
			if (field?.type === "options_list") {
				for (const value of values) {
					if (!field.possibleValues.includes(value)) {
						warnings.push(
							`rule "${rule.id}": "${value}" is not one of the field's options (${field.possibleValues.join(", ")})`,
						);
					}
				}
			}
			check = {
				check: "one_of",
				values,
				case_sensitive: rule.case_sensitive,
			};
		} else {
			check = rule;
		}

		const hint =
			check.check === "one_of"
				? rule.hint.replaceAll("{values}", check.values.join(", "))
				: rule.hint;

		prepared.push({
			id: rule.id,
			hint,
			target,
			check,
			onlyUsers: rule.only_users,
			excludeUsers: rule.exclude_users,
		});
	});

	if (problems.length > 0) {
		throw new ConfigError(problems);
	}
	return { rules: prepared, warnings };
}
