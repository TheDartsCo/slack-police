import { expect, it } from "vitest";
import { loadConfig, parseConfigText } from "../../src/config/load.js";
import { ConfigError, formatIssuePath } from "../../src/config/schema.js";

function problems(yaml: string): string[] {
	try {
		parseConfigText(yaml);
	} catch (err) {
		if (err instanceof ConfigError) {
			return err.problems;
		}
		throw err;
	}
	throw new Error("expected parseConfigText to throw ConfigError");
}

const minimal = `rules:\n  - id: photo\n    field: photo\n    check: required\n    hint: Upload a photo`;

it("applies defaults", () => {
	const c = parseConfigText(minimal);
	expect(c.dry_run).toBe(true);
	expect(c.schedule).toEqual({ check: "0 * * * 1-5", timezone: "UTC" });
	expect(c.reminders.every).toBe("7d");
	expect(c.scope.include_guests).toBe(false);
	expect(c.messages.intro).toBe(
		"Hi {first_name}! A few things are missing from your Slack profile:",
	);
	expect(c.admin_report).toBeUndefined();
});

it("phone and one_of defaults", () => {
	const c = parseConfigText(
		`rules:\n  - {id: p, field: phone, check: phone, hint: h}\n  - {id: d, custom_field: Dept, check: one_of, hint: h}`,
	);
	const [phone, dept] = c.rules;
	expect(phone).toMatchObject({
		check: "phone",
		validation: "possible",
		mobile_only: false,
		strict_e164: false,
	});
	expect(dept).toMatchObject({ check: "one_of", case_sensitive: false });
});

it("parses the spec §7.2 example", () => {
	const example = `dry_run: true                    # log + admin summary only; no DMs to people. Set false when happy.

schedule:
  check: "0 * * * 1-5"           # cron for check passes (default: hourly on weekdays)
  timezone: "UTC"                # timezone for all cron expressions in this file

reminders:
  every: 7d                      # min gap between reminders to the same person (units: m, h, d, w)
  working_hours:                 # optional; evaluated in each person's own Slack time zone
    start: "09:00"
    end: "17:00"
    days: [mon, tue, wed, thu, fri]

scope:                           # who the bot looks at at all
  include_guests: false          # is_restricted / is_ultra_restricted
  exclude_users: [U01ABCDEF, ceo@example.com]
  # only_users: [you@example.com]   # pilot mode: only these people

rules:
  - id: photo
    field: photo
    check: required              # for photo: a custom image has been uploaded
    hint: "Upload a profile photo: click your avatar → Profile → Edit."

  - id: phone
    field: phone
    check: phone                 # international number starting with "+"
    validation: possible         # possible (right length; default) | valid (strict libphonenumber validity)
    mobile_only: false           # true = reject numbers libphonenumber identifies as landlines
    strict_e164: false           # true = exactly +<digits>, no spaces
    hint: "Add your mobile number in international format, e.g. +971 50 123 4567."
    exclude_users: [U02CONTRACTOR]

  - id: department               # paid plans only
    custom_field: "Department"   # custom profile field, by its label
    check: one_of
    values: [Engineering, Tech, Design, Operations]   # optional for options_list fields
    hint: "Set your Department to one of: {values}."

admin_report:                    # optional
  channel: C0123ABCDEF
  schedule: "0 9 * * 1"          # Mondays 09:00 (schedule.timezone)

messages:                        # optional overrides; defaults ship with the app
  intro: "Hi {first_name}! A few things are missing from your Slack profile:"
  footer: "I'll remind you every {every} until it's done."
  all_done: "✅ All set. Thanks for completing your profile!"
`;
	expect(() => parseConfigText(example)).not.toThrow();
	expect(parseConfigText(example).rules).toHaveLength(3);
});

it("formatIssuePath", () =>
	expect(formatIssuePath(["rules", 2, "values"])).toBe("rules[2].values"));

it.each<[string, string, string | ((p: string) => boolean)]>([
	[
		"unknown key",
		`rules:\n  - {id: a, field: photo, check: required, hint: h, colour: red}`,
		(p: string) => p.startsWith("rules[0]") && p.includes("colour"),
	],
	[
		"duplicate id",
		`rules:\n  - {id: a, field: photo, check: required, hint: h}\n  - {id: a, field: title, check: required, hint: h}`,
		'rules[1].id: duplicate rule id "a"',
	],
	[
		"both field kinds",
		`rules:\n  - {id: a, field: title, custom_field: Dept, check: required, hint: h}`,
		"rules[0]: set exactly one of field or custom_field",
	],
	[
		"no field",
		`rules:\n  - {id: a, check: required, hint: h}`,
		"rules[0]: set exactly one of field or custom_field",
	],
	[
		"photo non-required",
		`rules:\n  - {id: a, field: photo, check: phone, hint: h}`,
		"rules[0].check: the photo field only supports check: required",
	],
	[
		"builtin one_of",
		`rules:\n  - {id: a, field: title, check: one_of, hint: h}`,
		"rules[0].values: required for built-in fields",
	],
	[
		"empty values",
		`rules:\n  - {id: a, custom_field: Dept, check: one_of, values: [], hint: h}`,
		"rules[0].values: must be a non-empty list",
	],
	[
		"empty global only",
		`scope: {only_users: []}\n${minimal}`,
		"scope.only_users: must be a non-empty list (remove the key to mean everyone)",
	],
	[
		"empty rule only",
		`rules:\n  - {id: a, field: photo, check: required, hint: h, only_users: []}`,
		"rules[0].only_users: must be a non-empty list (remove the key to mean everyone)",
	],
	[
		"bad cron",
		`schedule: {check: every hour}\n${minimal}`,
		'schedule.check: invalid cron expression "every hour"',
	],
	[
		"bad timezone",
		`schedule: {timezone: Mars/Base}\n${minimal}`,
		'schedule.timezone: unknown time zone "Mars/Base"',
	],
	[
		"bad duration",
		`reminders: {every: "7"}\n${minimal}`,
		'reminders.every: invalid duration "7" (use e.g. 30m, 12h, 7d, 2w)',
	],
	[
		"bad HH:MM",
		`reminders: {working_hours: {start: 9am, end: "17:00", days: [mon]}}\n${minimal}`,
		"reminders.working_hours.start: use 24-hour HH:MM",
	],
	[
		"start >= end",
		`reminders: {working_hours: {start: "17:00", end: "09:00", days: [mon]}}\n${minimal}`,
		"reminders.working_hours: start must be before end",
	],
	[
		"bad regex",
		`rules:\n  - {id: a, field: title, check: regex, pattern: "(", hint: h}`,
		"rules[0].pattern: invalid regular expression",
	],
	[
		"channel name",
		`admin_report: {channel: "#ops", schedule: "0 9 * * 1"}\n${minimal}`,
		"admin_report.channel: use the channel ID (starts with C), not its name",
	],
	["no rules", `rules: []`, "rules: must be a non-empty list"],
])("%s", (_, yaml, expected) => {
	const ps = problems(yaml);
	typeof expected === "string"
		? expect(ps).toContain(expected)
		: expect(ps.some(expected)).toBe(true);
});

it("reports several field problems together", () =>
	expect(
		problems(
			`schedule: {timezone: Mars/Base}\nreminders: {every: "7"}\n${minimal}`,
		),
	).toHaveLength(2));

it("broken YAML names the line (Review Focus 3)", () => {
	expect(problems("rules:\n\t- id: a")[0]).toMatch(/line \d+/);
	expect(problems('rules:\n  - id: "a\n')[0]).toMatch(/line \d+/);
});

it("missing file", async () => {
	await expect(loadConfig("/nope.yaml")).rejects.toMatchObject({
		problems: ["config file not found: /nope.yaml"],
	});
});
