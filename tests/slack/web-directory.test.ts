import type { WebClient } from "@slack/web-api";
import { describe, expect, it, vi } from "vitest";
import {
	mapFieldDef,
	mapUser,
	WebSlackDirectory,
} from "../../src/slack/web-directory.js";
import { FakeSlackDirectory, makeUser } from "../support/fake-directory.js";

const member = {
	id: "U1",
	deleted: false,
	is_bot: false,
	is_restricted: false,
	is_ultra_restricted: false,
	tz: "Asia/Dubai",
	profile: {
		first_name: "Sara",
		real_name: "Sara Ali",
		display_name: "sara",
		phone: "+971501234567",
		title: "Dev",
		pronouns: "she/her",
		email: "sara@example.com",
		is_custom_image: true,
	},
};

it("mapUser", () =>
	expect(mapUser(member)).toEqual({
		id: "U1",
		deleted: false,
		isBot: false,
		isRestricted: false,
		isUltraRestricted: false,
		isInvitedUser: false,
		isStranger: false,
		tz: "Asia/Dubai",
		email: "sara@example.com",
		firstName: "Sara",
		profile: {
			hasCustomImage: true,
			phone: "+971501234567",
			title: "Dev",
			displayName: "sara",
			realName: "Sara Ali",
			pronouns: "she/her",
			customFields: {},
		},
	}));

it('firstName falls back to real_name word, then display_name, then "there"', () => {
	const profile: Partial<typeof member.profile> = { ...member.profile };
	delete profile.first_name;
	expect(mapUser({ ...member, profile }).firstName).toBe("Sara");
	delete profile.real_name;
	expect(mapUser({ ...member, profile }).firstName).toBe("sara");
	delete profile.display_name;
	expect(mapUser({ ...member, profile }).firstName).toBe("there");
});

it("missing is_custom_image stays undefined", () => {
	const profile: Partial<typeof member.profile> = { ...member.profile };
	delete profile.is_custom_image;
	expect(
		mapUser({ ...member, profile }).profile.hasCustomImage,
	).toBeUndefined();
});

it("mapUser tolerates missing flags, tz and email", () => {
	const u = mapUser({ id: "U9" });
	expect(u.deleted).toBe(false);
	expect(u.isBot).toBe(false);
	expect(u.isRestricted).toBe(false);
	expect(u.isUltraRestricted).toBe(false);
	expect(u.isInvitedUser).toBe(false);
	expect(u.isStranger).toBe(false);
	expect(u.tz).toBeUndefined();
	expect(u.email).toBeUndefined();
	expect(u.firstName).toBe("there");
	expect(u.profile.customFields).toEqual({});
});

it("listUsers paginates with limit 200", async () => {
	const list = vi
		.fn()
		.mockResolvedValueOnce({
			members: [member],
			response_metadata: { next_cursor: "c2" },
		})
		.mockResolvedValueOnce({
			members: [{ ...member, id: "U2" }],
			response_metadata: { next_cursor: "" },
		});
	const dir = new WebSlackDirectory({
		users: { list },
	} as unknown as WebClient);
	expect((await dir.listUsers()).map((u) => u.id)).toEqual(["U1", "U2"]);
	expect(list.mock.calls.map((c) => c[0])).toEqual([
		{ limit: 200, cursor: undefined },
		{ limit: 200, cursor: "c2" },
	]);
});

it("getProfile never asks for labels and maps fields", async () => {
	const get = vi.fn().mockResolvedValue({
		profile: {
			is_custom_image: false,
			fields: { Xf1: { value: "Tech", alt: "" } },
		},
	});
	const dir = new WebSlackDirectory({
		users: { profile: { get } },
	} as unknown as WebClient);
	expect(await dir.getProfile("U1")).toEqual({
		hasCustomImage: false,
		customFields: { Xf1: "Tech" },
	});
	expect(get).toHaveBeenCalledWith({ user: "U1" });
});

it("getProfile with null fields → {}", async () => {
	const get = vi.fn().mockResolvedValue({ profile: { fields: null } });
	const dir = new WebSlackDirectory({
		users: { profile: { get } },
	} as unknown as WebClient);
	expect(await dir.getProfile("U1")).toEqual({
		hasCustomImage: undefined,
		customFields: {},
	});
	expect(get).toHaveBeenCalledWith({ user: "U1" });
});

it("mapFieldDef", () =>
	expect(
		mapFieldDef({
			id: "Xf1",
			label: "Department",
			type: "options_list",
			possible_values: ["Eng"],
			is_hidden: false,
			options: { is_scim: true, is_protected: false },
		}),
	).toEqual({
		id: "Xf1",
		label: "Department",
		type: "options_list",
		possibleValues: ["Eng"],
		isHidden: false,
		isScim: true,
	}));

it("mapFieldDef tolerates null possible_values and string options", () =>
	expect(
		mapFieldDef({
			id: "Xf2",
			label: "Department",
			type: "text",
			possible_values: null,
			is_hidden: false,
			options: "legacy",
		}),
	).toEqual({
		id: "Xf2",
		label: "Department",
		type: "text",
		possibleValues: [],
		isHidden: false,
		isScim: false,
	}));

it("openDm uses conversations.open", async () => {
	const open = vi.fn().mockResolvedValue({ channel: { id: "D1" } });
	const dir = new WebSlackDirectory({
		conversations: { open },
	} as unknown as WebClient);
	expect(await dir.openDm("U1")).toBe("D1");
	expect(open).toHaveBeenCalledWith({ users: "U1" });
});

it("authTest maps team name", async () => {
	const test = vi.fn().mockResolvedValue({ team: "Acme" });
	const dir = new WebSlackDirectory({
		auth: { test },
	} as unknown as WebClient);
	expect(await dir.authTest()).toEqual({ teamName: "Acme" });
});

it("getUser uses users.info and maps the user", async () => {
	const info = vi.fn().mockResolvedValue({ user: member });
	const dir = new WebSlackDirectory({
		users: { info },
	} as unknown as WebClient);
	expect((await dir.getUser("U1")).id).toBe("U1");
	expect(info).toHaveBeenCalledWith({ user: "U1" });
});

it("listCustomFields maps team.profile.get fields", async () => {
	const get = vi.fn().mockResolvedValue({
		profile: {
			fields: [
				{
					id: "Xf1",
					label: "Department",
					type: "options_list",
					possible_values: ["Eng"],
					is_hidden: false,
					options: { is_scim: true },
				},
			],
		},
	});
	const dir = new WebSlackDirectory({
		team: { profile: { get } },
	} as unknown as WebClient);
	expect(await dir.listCustomFields()).toEqual([
		{
			id: "Xf1",
			label: "Department",
			type: "options_list",
			possibleValues: ["Eng"],
			isHidden: false,
			isScim: true,
		},
	]);
});

it("postMessage and updateMessage pass channel, text and blocks", async () => {
	const post = vi.fn().mockResolvedValue({ ts: "123.456" });
	const update = vi.fn().mockResolvedValue({});
	const dir = new WebSlackDirectory({
		chat: { postMessage: post, update },
	} as unknown as WebClient);
	const msg = { text: "hi", blocks: [] };
	expect(await dir.postMessage("D1", msg)).toEqual({ ts: "123.456" });
	expect(post).toHaveBeenCalledWith({ channel: "D1", text: "hi", blocks: [] });
	await dir.updateMessage("D1", "123.456", msg);
	expect(update).toHaveBeenCalledWith({
		channel: "D1",
		ts: "123.456",
		text: "hi",
		blocks: [],
	});
});

describe("FakeSlackDirectory", () => {
	it("makeUser defaults to a compliant-looking member", () => {
		expect(makeUser({ id: "U1" })).toEqual({
			id: "U1",
			deleted: false,
			isBot: false,
			isRestricted: false,
			isUltraRestricted: false,
			isInvitedUser: false,
			isStranger: false,
			tz: "UTC",
			email: undefined,
			firstName: "Test",
			profile: {
				hasCustomImage: true,
				phone: "+971501234567",
				title: "",
				displayName: "",
				realName: "",
				pronouns: "",
				customFields: {},
			},
		});
	});

	it("makeUser merges overrides", () => {
		const u = makeUser({
			id: "U2",
			isBot: true,
			profile: { phone: "" },
		});
		expect(u.isBot).toBe(true);
		expect(u.profile.phone).toBe("");
		expect(u.profile.hasCustomImage).toBe(true);
	});

	it("openDm returns D-prefixed ids and records calls", async () => {
		const fake = new FakeSlackDirectory();
		expect(await fake.openDm("U1")).toBe("DU1");
		expect(fake.openDmCalls).toEqual(["U1"]);
	});

	it("postMessage returns sequential ts values and records posts", async () => {
		const fake = new FakeSlackDirectory();
		const msg = { text: "hi", blocks: [] };
		expect(await fake.postMessage("DU1", msg)).toEqual({ ts: "1.0" });
		expect(await fake.postMessage("DU2", msg)).toEqual({ ts: "2.0" });
		expect(fake.posted).toEqual([
			{ channel: "DU1", msg },
			{ channel: "DU2", msg },
		]);
		await fake.updateMessage("DU1", "1.0", msg);
		expect(fake.updated).toEqual([{ channel: "DU1", ts: "1.0", msg }]);
	});

	it("authError and postError reject when set", async () => {
		const fake = new FakeSlackDirectory();
		const authErr = new Error("invalid_auth");
		const postErr = new Error("channel_not_found");
		fake.authError = authErr;
		fake.postError = postErr;
		await expect(fake.authTest()).rejects.toBe(authErr);
		await expect(
			fake.postMessage("DU1", { text: "hi", blocks: [] }),
		).rejects.toBe(postErr);
	});

	it("getProfile records calls, serves profiles and honours failProfileFor", async () => {
		const fake = new FakeSlackDirectory();
		fake.users = [makeUser({ id: "U1" })];
		fake.profiles.set("U1", { Xf1: "Tech" });
		expect(await fake.getProfile("U1")).toEqual({
			hasCustomImage: true,
			customFields: { Xf1: "Tech" },
		});
		expect(fake.getProfileCalls).toEqual(["U1"]);
		fake.failProfileFor.add("U1");
		await expect(fake.getProfile("U1")).rejects.toThrow();
	});

	it("getUser records calls and returns the user", async () => {
		const fake = new FakeSlackDirectory();
		fake.users = [makeUser({ id: "U1" })];
		expect((await fake.getUser("U1")).id).toBe("U1");
		expect(fake.getUserCalls).toEqual(["U1"]);
		await expect(fake.getUser("U404")).rejects.toThrow();
	});
});
