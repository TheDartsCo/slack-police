import type { Config } from "../config/schema.js";
import { evaluateRules, needsProfileFetch } from "../rules/evaluate.js";
import type { PreparedRule } from "../rules/prepare.js";
import type { RuleFailure } from "../rules/evaluate.js";
import {
	inGlobalScope,
	inScope,
	indexUsers,
	isBaselineEligible,
	resolveRefs,
	type ResolvedScope,
	type UserIndex,
} from "../scope/scope.js";
import type { SlackDirectory, SlackUser } from "../slack/types.js";

export type Population = {
	index: UserIndex;
	global: ResolvedScope;
	ruleScopes: Map<string, ResolvedScope>;
	inScope: SlackUser[];
};

function toScope(
	only: string[] | undefined,
	exclude: string[] | undefined,
	index: UserIndex,
): ResolvedScope {
	return {
		only: resolveRefs(only, index).ids,
		exclude: resolveRefs(exclude, index).ids ?? new Set(),
	};
}

export function buildPopulation(
	users: SlackUser[],
	config: Config,
	rules: PreparedRule[],
): Population {
	const index = indexUsers(users);
	const global = toScope(
		config.scope.only_users,
		config.scope.exclude_users,
		index,
	);
	const ruleScopes = new Map<string, ResolvedScope>();
	for (const rule of rules) {
		ruleScopes.set(rule.id, toScope(rule.onlyUsers, rule.excludeUsers, index));
	}
	const inScopeUsers = users.filter(
		(u) =>
			isBaselineEligible(u) &&
			inGlobalScope(u, config.scope.include_guests, global),
	);
	return { index, global, ruleScopes, inScope: inScopeUsers };
}

export function applicableRules(
	userId: string,
	rules: PreparedRule[],
	ruleScopes: Map<string, ResolvedScope>,
): PreparedRule[] {
	return rules.filter((rule) =>
		inScope(
			userId,
			ruleScopes.get(rule.id) ?? { only: undefined, exclude: new Set() },
		),
	);
}

export async function assessUser(
	user: SlackUser,
	applicable: PreparedRule[],
	dir: SlackDirectory,
): Promise<RuleFailure[]> {
	let profile = user.profile;
	if (needsProfileFetch(applicable, profile)) {
		const fetched = await dir.getProfile(user.id);
		profile = {
			...profile,
			hasCustomImage: fetched.hasCustomImage ?? profile.hasCustomImage,
			customFields: { ...profile.customFields, ...fetched.customFields },
		};
	}
	return evaluateRules(profile, applicable);
}