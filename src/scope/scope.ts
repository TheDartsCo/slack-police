import type { SlackUser } from "../slack/types.js";

export type ResolvedScope = {
	only: Set<string> | undefined;
	exclude: Set<string>;
};

export type UserIndex = {
	byId: Map<string, SlackUser>;
	byEmail: Map<string, SlackUser>;
};

const ID_REF = /^[UW][A-Z0-9]+$/;

export function indexUsers(users: SlackUser[]): UserIndex {
	const byId = new Map<string, SlackUser>();
	const byEmail = new Map<string, SlackUser>();
	for (const user of users) {
		byId.set(user.id, user);
		if (user.email !== undefined) {
			const key = user.email.toLowerCase();
			if (!byEmail.has(key)) {
				byEmail.set(key, user);
			}
		}
	}
	return { byId, byEmail };
}

export function resolveRefs(
	refs: string[] | undefined,
	index: UserIndex,
): {
	ids: Set<string> | undefined;
	unknown: string[];
	deactivated: string[];
} {
	if (refs === undefined) {
		return { ids: undefined, unknown: [], deactivated: [] };
	}
	const ids = new Set<string>();
	const unknown: string[] = [];
	const deactivated: string[] = [];
	for (const ref of refs) {
		if (ID_REF.test(ref)) {
			ids.add(ref);
			const user = index.byId.get(ref);
			if (user === undefined) {
				unknown.push(ref);
			} else if (user.deleted) {
				deactivated.push(ref);
			}
			continue;
		}
		const user = index.byEmail.get(ref.toLowerCase());
		if (user === undefined) {
			unknown.push(ref);
			continue;
		}
		ids.add(user.id);
		if (user.deleted) {
			deactivated.push(ref);
		}
	}
	return { ids, unknown, deactivated };
}

export function isBaselineEligible(u: SlackUser): boolean {
	return (
		!u.deleted &&
		!u.isBot &&
		u.id !== "USLACKBOT" &&
		!u.isInvitedUser &&
		!u.isStranger
	);
}

export function inGlobalScope(
	u: SlackUser,
	includeGuests: boolean,
	scope: ResolvedScope,
): boolean {
	if (!includeGuests && (u.isRestricted || u.isUltraRestricted)) {
		return false;
	}
	return inScope(u.id, scope);
}

export function inScope(userId: string, scope: ResolvedScope): boolean {
	if (scope.only !== undefined && !scope.only.has(userId)) {
		return false;
	}
	return !scope.exclude.has(userId);
}