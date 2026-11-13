import { loadConfig } from "../config/load.js";
import type { Config } from "../config/schema.js";
import { prepareRules, type PreparedRule } from "../rules/prepare.js";
import { indexUsers, resolveRefs } from "../scope/scope.js";
import { slackErrorCode } from "../slack/errors.js";
import type { SlackDirectory } from "../slack/types.js";

export type Bootstrapped = {
	config: Config;
	rules: PreparedRule[];
	teamName: string;
	warnings: string[];
};

export async function bootstrap(
	configPath: string,
	dir: SlackDirectory,
): Promise<Bootstrapped> {
	const config = await loadConfig(configPath);

	let teamName: string;
	try {
		({ teamName } = await dir.authTest());
	} catch (err) {
		throw new Error(
			`Slack rejected SLACK_BOT_TOKEN: ${slackErrorCode(err) ?? "unknown error"}`,
		);
	}

	const fields = await dir.listCustomFields();
	const { rules, warnings } = prepareRules(config.rules, fields);

	const users = await dir.listUsers();
	const index = indexUsers(users);
	const lists: { path: string; refs: string[] | undefined }[] = [
		{ path: "scope.only_users", refs: config.scope.only_users },
		{ path: "scope.exclude_users", refs: config.scope.exclude_users },
		...config.rules.flatMap((rule, i) => [
			{ path: `rules[${i}].only_users`, refs: rule.only_users },
			{ path: `rules[${i}].exclude_users`, refs: rule.exclude_users },
		]),
	];
	for (const { path, refs } of lists) {
		const { unknown, deactivated } = resolveRefs(refs, index);
		for (const ref of unknown) {
			warnings.push(`${path}: "${ref}" matches nobody in this workspace`);
		}
		for (const ref of deactivated) {
			warnings.push(`${path}: "${ref}" is a deactivated account`);
		}
	}

	return { config, rules, teamName, warnings };
}