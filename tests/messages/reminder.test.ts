import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGES } from "../../src/config/schema.js";
import {
	buildAllDone,
	buildReminder,
	buildStillMissing,
	CHECK_AGAIN_ACTION_ID,
	escapeText,
	renderTemplate,
} from "../../src/messages/reminder.js";

const failures = [
	{ ruleId: "photo", hint: "Upload a photo." },
	{ ruleId: "phone", hint: "Add your mobile." },
];

describe("renderTemplate", () => {
	it("substitutes known keys and leaves unknown ones", () => {
		expect(renderTemplate("Hi {first_name}! {unknown}", { first_name: "Sara" })).toBe(
			"Hi Sara! {unknown}",
		);
	});
});

describe("escapeText", () => {
	it("escapes & < >", () =>
		expect(escapeText("<b>&")).toBe("&lt;b&gt;&amp;"));
});

describe("buildReminder", () => {
	it("reminder blocks", () => {
		const m = buildReminder({
			firstName: "Sara",
			failures,
			messages: DEFAULT_MESSAGES,
			every: "7 days",
		});
		expect(m.text).toBe(
			"Hi Sara! A few things are missing from your Slack profile:",
		);
		expect(m.blocks).toEqual([
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: "Hi Sara! A few things are missing from your Slack profile:",
				},
			},
			{
				type: "section",
				text: { type: "mrkdwn", text: "• Upload a photo.\n• Add your mobile." },
			},
			{
				type: "context",
				elements: [
					{ type: "mrkdwn", text: "I'll remind you every 7 days until it's done." },
				],
			},
			{
				type: "actions",
				elements: [
					{
						type: "button",
						action_id: "check_again",
						style: "primary",
						text: { type: "plain_text", text: "Check again" },
					},
				],
			},
		]);
	});

	it("escapes the first name", () =>
		expect(
			buildReminder({
				firstName: "<b>&",
				failures,
				messages: DEFAULT_MESSAGES,
				every: "week",
			}).text,
		).toBe("Hi &lt;b&gt;&amp;! A few things are missing from your Slack profile:"));
});

describe("buildStillMissing", () => {
	it('adds "Checked just now" before the footer', () => {
		const ctx = buildStillMissing({
			firstName: "Sara",
			failures,
			messages: DEFAULT_MESSAGES,
			every: "7 days",
		}).blocks[2];
		expect(ctx).toEqual({
			type: "context",
			elements: [
				{ type: "mrkdwn", text: "Checked just now" },
				{ type: "mrkdwn", text: "I'll remind you every 7 days until it's done." },
			],
		});
	});
});

describe("buildAllDone", () => {
	it("has no button", () =>
		expect(buildAllDone(DEFAULT_MESSAGES)).toEqual({
			text: "✅ All set. Thanks for completing your profile!",
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: "✅ All set. Thanks for completing your profile!",
					},
				},
			],
		}));
});

describe("constants", () => {
	it("action id", () => expect(CHECK_AGAIN_ACTION_ID).toBe("check_again"));
});