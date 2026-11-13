import type { KnownBlock } from "@slack/types";

export type UserProfile = {
	hasCustomImage: boolean | undefined;
	phone: string;
	title: string;
	displayName: string;
	realName: string;
	pronouns: string;
	/** Field ID → value. `{}` when the user came from `users.list`. */
	customFields: Record<string, string>;
};

export type SlackUser = {
	id: string;
	deleted: boolean;
	isBot: boolean;
	isRestricted: boolean;
	isUltraRestricted: boolean;
	isInvitedUser: boolean;
	isStranger: boolean;
	tz: string | undefined;
	email: string | undefined;
	firstName: string;
	profile: UserProfile;
};

export type CustomFieldDef = {
	id: string;
	label: string;
	type: string;
	possibleValues: string[];
	isHidden: boolean;
	isScim: boolean;
};

export type SlackMessage = {
	text: string;
	blocks: KnownBlock[];
};

export interface SlackDirectory {
	authTest(): Promise<{ teamName: string }>;
	listUsers(): Promise<SlackUser[]>;
	getUser(userId: string): Promise<SlackUser>;
	getProfile(userId: string): Promise<{
		hasCustomImage: boolean | undefined;
		customFields: Record<string, string>;
	}>;
	listCustomFields(): Promise<CustomFieldDef[]>;
	openDm(userId: string): Promise<string>;
	postMessage(channel: string, msg: SlackMessage): Promise<{ ts: string }>;
	updateMessage(channel: string, ts: string, msg: SlackMessage): Promise<void>;
}
