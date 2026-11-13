import type { WebClient } from "@slack/web-api";
import type {
	CustomFieldDef,
	SlackDirectory,
	SlackMessage,
	SlackUser,
} from "./types.js";

/** Trimmed `users.list` / `users.info` member shape (only what we read). */
export type RawUser = {
	id: string;
	deleted?: boolean;
	is_bot?: boolean;
	is_restricted?: boolean;
	is_ultra_restricted?: boolean;
	is_invited_user?: boolean;
	is_stranger?: boolean;
	tz?: string;
	profile?: {
		first_name?: string;
		real_name?: string;
		display_name?: string;
		phone?: string;
		title?: string;
		pronouns?: string;
		email?: string;
		is_custom_image?: boolean;
	};
};

/** Trimmed `team.profile.get` field shape. `options` is occasionally a string. */
export type RawFieldDef = {
	id: string;
	label?: string;
	type?: string;
	possible_values?: string[] | null;
	is_hidden?: boolean;
	options?: { is_scim?: boolean; is_protected?: boolean } | string | null;
};

export function mapUser(raw: RawUser): SlackUser {
	const profile = raw.profile ?? {};
	const firstName =
		profile.first_name ||
		profile.real_name?.trim().split(/\s+/)[0] ||
		profile.display_name ||
		"there";
	return {
		id: raw.id,
		deleted: raw.deleted ?? false,
		isBot: raw.is_bot ?? false,
		isRestricted: raw.is_restricted ?? false,
		isUltraRestricted: raw.is_ultra_restricted ?? false,
		isInvitedUser: raw.is_invited_user ?? false,
		isStranger: raw.is_stranger ?? false,
		tz: raw.tz,
		email: profile.email,
		firstName,
		profile: {
			// Missing `is_custom_image` must stay undefined: later tasks use
			// undefined to trigger a `users.profile.get` fetch.
			hasCustomImage: profile.is_custom_image,
			phone: profile.phone ?? "",
			title: profile.title ?? "",
			displayName: profile.display_name ?? "",
			realName: profile.real_name ?? "",
			pronouns: profile.pronouns ?? "",
			customFields: {},
		},
	};
}

export function mapFieldDef(raw: RawFieldDef): CustomFieldDef {
	const options = raw.options;
	return {
		id: raw.id,
		label: raw.label ?? "",
		type: raw.type ?? "",
		possibleValues: raw.possible_values ?? [],
		isHidden: raw.is_hidden ?? false,
		isScim:
			typeof options === "object" && options !== null
				? (options.is_scim ?? false)
				: false,
	};
}

export class WebSlackDirectory implements SlackDirectory {
	private readonly client: WebClient;

	constructor(client: WebClient) {
		this.client = client;
	}

	async authTest(): Promise<{ teamName: string }> {
		const res = await this.client.auth.test();
		return { teamName: res.team ?? "" };
	}

	async listUsers(): Promise<SlackUser[]> {
		const users: SlackUser[] = [];
		let cursor: string | undefined;
		do {
			const res = await this.client.users.list({ limit: 200, cursor });
			for (const m of res.members ?? []) {
				users.push(mapUser({ ...m, id: m.id ?? "" }));
			}
			cursor = res.response_metadata?.next_cursor || undefined;
		} while (cursor !== undefined);
		return users;
	}

	async getUser(userId: string): Promise<SlackUser> {
		const res = await this.client.users.info({ user: userId });
		return mapUser({ ...res.user, id: res.user?.id ?? userId });
	}

	async getProfile(userId: string): Promise<{
		hasCustomImage: boolean | undefined;
		customFields: Record<string, string>;
	}> {
		// Never pass include_labels: we only need values, and labels bloat responses.
		const res = await this.client.users.profile.get({ user: userId });
		const customFields: Record<string, string> = {};
		for (const [id, field] of Object.entries(res.profile?.fields ?? {})) {
			customFields[id] = field?.value ?? "";
		}
		return {
			hasCustomImage: res.profile?.is_custom_image,
			customFields,
		};
	}

	async listCustomFields(): Promise<CustomFieldDef[]> {
		const res = await this.client.team.profile.get();
		return (res.profile?.fields ?? []).map((f) =>
			mapFieldDef({ ...f, id: f.id ?? "" }),
		);
	}

	async openDm(userId: string): Promise<string> {
		const res = await this.client.conversations.open({ users: userId });
		return res.channel?.id ?? "";
	}

	async postMessage(
		channel: string,
		msg: SlackMessage,
	): Promise<{ ts: string }> {
		const res = await this.client.chat.postMessage({
			channel,
			text: msg.text,
			blocks: msg.blocks,
		});
		return { ts: res.ts ?? "" };
	}

	async updateMessage(
		channel: string,
		ts: string,
		msg: SlackMessage,
	): Promise<void> {
		await this.client.chat.update({
			channel,
			ts,
			text: msg.text,
			blocks: msg.blocks,
		});
	}
}
