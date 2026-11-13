import type { MessagesConfig } from "../config/schema.js";
import type { RuleFailure } from "../rules/evaluate.js";
import type { SlackMessage } from "../slack/types.js";

export const CHECK_AGAIN_ACTION_ID = "check_again";

export function renderTemplate(
	tpl: string,
	vars: Record<string, string>,
): string {
	return tpl.replace(/\{(\w+)\}/g, (match, key: string) =>
		key in vars ? (vars[key] as string) : match,
	);
}

export function escapeText(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

type ReminderArgs = {
	firstName: string;
	failures: RuleFailure[];
	messages: MessagesConfig;
	every: string;
};

function reminderBlocks(
	a: ReminderArgs,
	contextElements: { type: "mrkdwn"; text: string }[],
): SlackMessage {
	const intro = renderTemplate(a.messages.intro, {
		first_name: escapeText(a.firstName),
	});
	const bullets = a.failures.map((f) => `• ${f.hint}`).join("\n");
	return {
		text: intro,
		blocks: [
			{ type: "section", text: { type: "mrkdwn", text: intro } },
			{ type: "section", text: { type: "mrkdwn", text: bullets } },
			{ type: "context", elements: contextElements },
			{
				type: "actions",
				elements: [
					{
						type: "button",
						action_id: CHECK_AGAIN_ACTION_ID,
						style: "primary",
						text: { type: "plain_text", text: "Check again" },
					},
				],
			},
		],
	};
}

export function buildReminder(a: ReminderArgs): SlackMessage {
	const footer = renderTemplate(a.messages.footer, { every: a.every });
	return reminderBlocks(a, [{ type: "mrkdwn", text: footer }]);
}

export function buildStillMissing(a: ReminderArgs): SlackMessage {
	const footer = renderTemplate(a.messages.footer, { every: a.every });
	return reminderBlocks(a, [
		{ type: "mrkdwn", text: "Checked just now" },
		{ type: "mrkdwn", text: footer },
	]);
}

export function buildAllDone(messages: MessagesConfig): SlackMessage {
	return {
		text: messages.all_done,
		blocks: [
			{ type: "section", text: { type: "mrkdwn", text: messages.all_done } },
		],
	};
}