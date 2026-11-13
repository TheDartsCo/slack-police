import { describe, expect, it } from "vitest";
import {
	inGlobalScope,
	inScope,
	indexUsers,
	isBaselineEligible,
	resolveRefs,
} from "../../src/scope/scope.js";
import { makeUser } from "../support/fake-directory.js";

describe("isBaselineEligible", () => {
	it.each([
		["deleted", { deleted: true }],
		["bot", { isBot: true }],
		["Slackbot", { id: "USLACKBOT" }],
		["invited", { isInvitedUser: true }],
		["Slack Connect", { isStranger: true }],
	])("baseline skips %s", (_, o) =>
		expect(isBaselineEligible(makeUser({ id: "U1", ...o }))).toBe(false),
	);

	it("baseline keeps a normal member", () =>
		expect(isBaselineEligible(makeUser({ id: "U1" }))).toBe(true));
});

describe("inGlobalScope", () => {
	it("guests only when included", () => {
		const g = makeUser({ id: "U1", isRestricted: true });
		const sg = makeUser({ id: "U2", isUltraRestricted: true });
		const all = { only: undefined, exclude: new Set<string>() };
		expect([
			inGlobalScope(g, false, all),
			inGlobalScope(sg, false, all),
		]).toEqual([false, false]);
		expect([inGlobalScope(g, true, all), inGlobalScope(sg, true, all)]).toEqual(
			[true, true],
		);
	});
});

describe("inScope", () => {
	it("only then exclude; exclude wins", () => {
		const s = { only: new Set(["U1", "U2"]), exclude: new Set(["U2"]) };
		expect(["U1", "U2", "U3"].map((id) => inScope(id, s))).toEqual([
			true,
			false,
			false,
		]);
	});
});

describe("resolveRefs", () => {
	it("emails case-insensitively, IDs always, unknowns and deactivated reported", () => {
		const idx = indexUsers([
			makeUser({ id: "U1", email: "ceo@example.com" }),
			makeUser({ id: "U2", deleted: true }),
		]);
		expect(
			resolveRefs(["CEO@Example.com", "U999", "nobody@x.com", "U2"], idx),
		).toEqual({
			ids: new Set(["U1", "U999", "U2"]),
			unknown: ["U999", "nobody@x.com"],
			deactivated: ["U2"],
		});
		expect(resolveRefs(undefined, idx).ids).toBeUndefined();
	});
});
