import type {
	CustomFieldDef,
	SlackDirectory,
	SlackMessage,
	SlackUser,
	UserProfile,
} from "../../src/slack/types.js";

/** Defaults make a normal, compliant-looking member. */
export function makeUser(
	o: { id: string } & Partial<Omit<SlackUser, "profile">> & {
			profile?: Partial<UserProfile>;
		},
): SlackUser {
	const { profile, ...rest } = o;
	return {
		deleted: false,
		isBot: false,
		isRestricted: false,
		isUltraRestricted: false,
		isInvitedUser: false,
		isStranger: false,
		tz: "UTC",
		email: undefined,
		firstName: "Test",
		...rest,
		profile: {
			hasCustomImage: true,
			phone: "+971501234567",
			title: "",
			displayName: "",
			realName: "",
			pronouns: "",
			customFields: {},
			...profile,
		},
	};
}

export class FakeSlackDirectory implements SlackDirectory {
	teamName = "Acme";
	authError?: unknown;
	users: SlackUser[] = [];
	fields: CustomFieldDef[] = [];
	profiles = new Map<string, Record<string, string>>();
	failProfileFor = new Set<string>();
	getProfileCalls: string[] = [];
	getUserCalls: string[] = [];
	openDmCalls: string[] = [];
	posted: { channel: string; msg: SlackMessage }[] = [];
	updated: { channel: string; ts: string; msg: SlackMessage }[] = [];
	postError?: unknown;

	async authTest(): Promise<{ teamName: string }> {
		if (this.authError !== undefined) {
			throw this.authError;
		}
		return { teamName: this.teamName };
	}

	async listUsers(): Promise<SlackUser[]> {
		return [...this.users];
	}

	async getUser(userId: string): Promise<SlackUser> {
		this.getUserCalls.push(userId);
		const user = this.users.find((u) => u.id === userId);
		if (user === undefined) {
			throw new Error(`FakeSlackDirectory: no user ${userId}`);
		}
		return user;
	}

	async getProfile(userId: string): Promise<{
		hasCustomImage: boolean | undefined;
		customFields: Record<string, string>;
	}> {
		this.getProfileCalls.push(userId);
		if (this.failProfileFor.has(userId)) {
			throw new Error(`FakeSlackDirectory: profile fetch failed for ${userId}`);
		}
		const user = this.users.find((u) => u.id === userId);
		return {
			hasCustomImage: user?.profile.hasCustomImage,
			customFields: { ...(this.profiles.get(userId) ?? {}) },
		};
	}

	async listCustomFields(): Promise<CustomFieldDef[]> {
		return [...this.fields];
	}

	async openDm(userId: string): Promise<string> {
		this.openDmCalls.push(userId);
		return `D${userId}`;
	}

	async postMessage(
		channel: string,
		msg: SlackMessage,
	): Promise<{ ts: string }> {
		if (this.postError !== undefined) {
			throw this.postError;
		}
		this.posted.push({ channel, msg });
		return { ts: `${this.posted.length}.0` };
	}

	async updateMessage(
		channel: string,
		ts: string,
		msg: SlackMessage,
	): Promise<void> {
		this.updated.push({ channel, ts, msg });
	}
}
