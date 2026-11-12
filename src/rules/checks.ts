import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { CheckSpec } from "../config/schema.js";

export type FieldValue = string | boolean | undefined;

/** Same union as `CheckSpec`, but `one_of.values` is required. */
export type ResolvedCheck =
	| Exclude<CheckSpec, { check: "one_of" }>
	| (Extract<CheckSpec, { check: "one_of" }> & { values: string[] });

const STRICT_E164 = /^\+[1-9]\d{6,14}$/;

export function runCheck(check: ResolvedCheck, value: FieldValue): boolean {
	if (check.check === "required") {
		if (typeof value === "boolean") {
			return value;
		}
		return typeof value === "string" && value.trim() !== "";
	}

	// All remaining checks operate on strings; booleans/undefined always fail.
	if (typeof value !== "string") {
		return false;
	}
	const trimmed = value.trim();

	switch (check.check) {
		case "phone": {
			if (!trimmed.startsWith("+")) {
				return false;
			}
			if (check.strict_e164) {
				return STRICT_E164.test(trimmed);
			}
			const parsed = parsePhoneNumberFromString(trimmed);
			if (parsed === undefined) {
				return false;
			}
			const ok =
				check.validation === "valid" ? parsed.isValid() : parsed.isPossible();
			if (!ok) {
				return false;
			}
			if (check.mobile_only && parsed.getType() === "FIXED_LINE") {
				return false;
			}
			return true;
		}
		case "one_of": {
			const normalize = (s: string) =>
				check.case_sensitive ? s : s.toLowerCase();
			const candidate = normalize(trimmed);
			return check.values.some((option) => normalize(option) === candidate);
		}
		case "regex":
			return new RegExp(check.pattern).test(trimmed);
	}
}
