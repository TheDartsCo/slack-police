import { Cron } from "croner";
import { z } from "zod";
import { parseDuration } from "../time/duration.js";
import {
	isValidTimeZone,
	type Weekday,
	type WorkingHours,
} from "../time/zones.js";

export const BUILTIN_FIELDS = [
	"photo",
	"phone",
	"title",
	"display_name",
	"real_name",
	"pronouns",
] as const;

export type BuiltinField = (typeof BUILTIN_FIELDS)[number];

export type CheckSpec =
	| { check: "required" }
	| {
			check: "phone";
			validation: "possible" | "valid";
			mobile_only: boolean;
			strict_e164: boolean;
	  }
	| { check: "one_of"; values?: string[]; case_sensitive: boolean }
	| { check: "regex"; pattern: string };

export type RuleConfig = {
	id: string;
	field?: BuiltinField;
	custom_field?: string;
	hint: string;
	only_users?: string[];
	exclude_users?: string[];
} & CheckSpec;

export type MessagesConfig = {
	intro: string;
	footer: string;
	all_done: string;
};

export const DEFAULT_MESSAGES: MessagesConfig = {
	intro: "Hi {first_name}! A few things are missing from your Slack profile:",
	footer: "I'll remind you every {every} until it's done.",
	all_done: "✅ All set. Thanks for completing your profile!",
};

export type Config = {
	dry_run: boolean;
	schedule: { check: string; timezone: string };
	reminders: { every: string; working_hours?: WorkingHours };
	scope: {
		include_guests: boolean;
		only_users?: string[];
		exclude_users?: string[];
	};
	rules: RuleConfig[];
	admin_report?: { channel: string; schedule: string };
	messages: MessagesConfig;
};

export class ConfigError extends Error {
	readonly problems: string[];

	constructor(problems: string[]) {
		super(problems.join("\n"));
		this.name = "ConfigError";
		this.problems = problems;
	}
}

/** `['rules', 2, 'values']` → `rules[2].values`; `[]` → `""`. */
export function formatIssuePath(path: PropertyKey[]): string {
	let out = "";
	for (const key of path) {
		if (typeof key === "number") {
			out += `[${key}]`;
		} else {
			out += out === "" ? String(key) : `.${String(key)}`;
		}
	}
	return out;
}

function isValidCron(expr: string): boolean {
	try {
		new Cron(expr, { paused: true });
		return true;
	} catch {
		return false;
	}
}

function isValidDuration(input: string): boolean {
	try {
		parseDuration(input);
		return true;
	} catch {
		return false;
	}
}

function isValidRegex(pattern: string): boolean {
	try {
		new RegExp(pattern);
		return true;
	} catch {
		return false;
	}
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const cronString = z.string().refine(isValidCron, {
	error: (iss) => `invalid cron expression "${String(iss.input)}"`,
});

const timeZoneString = z.string().refine(isValidTimeZone, {
	error: (iss) => `unknown time zone "${String(iss.input)}"`,
});

const durationString = z.string().refine(isValidDuration, {
	error: (iss) =>
		`invalid duration "${String(iss.input)}" (use e.g. 30m, 12h, 7d, 2w)`,
});

const hhmmString = z.string().refine((v) => HH_MM.test(v), {
	message: "use 24-hour HH:MM",
});

const channelString = z.string().refine((v) => /^[CG][A-Z0-9]+$/.test(v), {
	message: "use the channel ID (starts with C), not its name",
});

const onlyUsers = z
	.array(z.string())
	.min(1, "must be a non-empty list (remove the key to mean everyone)");

const WEEKDAYS = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
] as const satisfies readonly Weekday[];

const workingHoursSchema = z.strictObject({
	start: hhmmString,
	end: hhmmString,
	days: z.array(z.enum(WEEKDAYS)),
});

const ruleBase = z.strictObject({
	id: z.string(),
	field: z.enum(BUILTIN_FIELDS).optional(),
	custom_field: z.string().optional(),
	hint: z.string(),
	only_users: onlyUsers.optional(),
	exclude_users: z.array(z.string()).optional(),
});

const ruleSchema = z.discriminatedUnion("check", [
	ruleBase.extend({ check: z.literal("required") }),
	ruleBase.extend({
		check: z.literal("phone"),
		validation: z.enum(["possible", "valid"]).default("possible"),
		mobile_only: z.boolean().default(false),
		strict_e164: z.boolean().default(false),
	}),
	ruleBase.extend({
		check: z.literal("one_of"),
		values: z.array(z.string()).min(1, "must be a non-empty list").optional(),
		case_sensitive: z.boolean().default(false),
	}),
	ruleBase.extend({
		check: z.literal("regex"),
		pattern: z.string().refine(isValidRegex, {
			message: "invalid regular expression",
		}),
	}),
]);

export const configSchema = z
	.strictObject({
		dry_run: z.boolean().default(true),
		schedule: z
			.strictObject({
				check: cronString.default("0 * * * 1-5"),
				timezone: timeZoneString.default("UTC"),
			})
			.default({ check: "0 * * * 1-5", timezone: "UTC" }),
		reminders: z
			.strictObject({
				every: durationString.default("7d"),
				working_hours: workingHoursSchema.optional(),
			})
			.default({ every: "7d" }),
		scope: z
			.strictObject({
				include_guests: z.boolean().default(false),
				only_users: onlyUsers.optional(),
				exclude_users: z.array(z.string()).optional(),
			})
			.default({ include_guests: false }),
		rules: z.array(ruleSchema).min(1, "must be a non-empty list"),
		admin_report: z
			.strictObject({
				channel: channelString,
				schedule: cronString,
			})
			.optional(),
		messages: z
			.strictObject({
				intro: z.string().default(DEFAULT_MESSAGES.intro),
				footer: z.string().default(DEFAULT_MESSAGES.footer),
				all_done: z.string().default(DEFAULT_MESSAGES.all_done),
			})
			.default(DEFAULT_MESSAGES),
	})
	.superRefine((config, ctx) => {
		const seen = new Set<string>();
		for (const [i, rule] of (config.rules ?? []).entries()) {
			if (rule === null || typeof rule !== "object") {
				continue;
			}
			if (typeof rule.id === "string") {
				if (seen.has(rule.id)) {
					ctx.addIssue({
						code: "custom",
						path: ["rules", i, "id"],
						message: `duplicate rule id "${rule.id}"`,
					});
				}
				seen.add(rule.id);
			}
			if ((rule.field === undefined) === (rule.custom_field === undefined)) {
				ctx.addIssue({
					code: "custom",
					path: ["rules", i],
					message: "set exactly one of field or custom_field",
				});
			}
			if (rule.field === "photo" && rule.check !== "required") {
				ctx.addIssue({
					code: "custom",
					path: ["rules", i, "check"],
					message: "the photo field only supports check: required",
				});
			}
			if (
				rule.field !== undefined &&
				rule.check === "one_of" &&
				rule.values === undefined
			) {
				ctx.addIssue({
					code: "custom",
					path: ["rules", i, "values"],
					message: "required for built-in fields",
				});
			}
		}
		const wh = config.reminders?.working_hours;
		if (
			wh !== undefined &&
			typeof wh.start === "string" &&
			typeof wh.end === "string" &&
			HH_MM.test(wh.start) &&
			HH_MM.test(wh.end) &&
			wh.start >= wh.end
		) {
			ctx.addIssue({
				code: "custom",
				path: ["reminders", "working_hours"],
				message: "start must be before end",
			});
		}
	});
