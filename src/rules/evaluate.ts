import type { UserProfile } from "../slack/types.js";
import { type FieldValue, runCheck } from "./checks.js";
import type { PreparedRule, RuleTarget } from "./prepare.js";

export type { PreparedRule, RuleTarget } from "./prepare.js";

export type RuleFailure = { ruleId: string; hint: string };

export function fieldValue(
	profile: UserProfile,
	target: RuleTarget,
): FieldValue {
	if (target.kind === "custom") {
		return profile.customFields[target.fieldId];
	}
	switch (target.field) {
		case "photo":
			return profile.hasCustomImage;
		case "phone":
			return profile.phone;
		case "title":
			return profile.title;
		case "display_name":
			return profile.displayName;
		case "real_name":
			return profile.realName;
		case "pronouns":
			return profile.pronouns;
	}
}

export function needsProfileFetch(
	rules: PreparedRule[],
	profile: UserProfile,
): boolean {
	return rules.some(
		(rule) =>
			rule.target.kind === "custom" ||
			(rule.target.kind === "builtin" &&
				rule.target.field === "photo" &&
				profile.hasCustomImage === undefined),
	);
}

export function evaluateRules(
	profile: UserProfile,
	rules: PreparedRule[],
): RuleFailure[] {
	const failures: RuleFailure[] = [];
	for (const rule of rules) {
		if (!runCheck(rule.check, fieldValue(profile, rule.target))) {
			failures.push({ ruleId: rule.id, hint: rule.hint });
		}
	}
	return failures;
}
