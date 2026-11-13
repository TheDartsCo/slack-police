import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { FakeSlackDirectory, makeUser } from "./support/fake-directory.js";

const dir = mkdtempSync(join(tmpdir(), "slack-police-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeConfig(yaml: string): string {
	const path = join(dir, `config-${Math.random().toString(36).slice(2)}.yaml`);
	writeFileSync(path, yaml);
	return path;
}

const GOOD_CONFIG = `rules:
  - id: photo
    field: photo
    check: required
    hint: Upload a photo.
`;

function io() {
	const out: string[] = [];
	const err: string[] = [];
	return {
		out,
		err,
		io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) },
	};
}

describe("main", () => {
	it("validate prints OK and warnings", async () => {
		const path = writeConfig(`scope:
  exclude_users: [x@y.com]
${GOOD_CONFIG}`);
		const fake = new FakeSlackDirectory();
		const { out, err, io: collector } = io();
		const code = await main(
			["validate"],
			{ SLACK_BOT_TOKEN: "xoxb-test", CONFIG_PATH: path },
			collector,
			() => fake,
		);
		expect(code).toBe(0);
		expect(err).toEqual([]);
		expect(out).toEqual([
			'Config OK for workspace "Acme"',
			'warning: scope.exclude_users: "x@y.com" matches nobody in this workspace',
		]);
	});

	it("validate with a bad config prints each problem", async () => {
		const path = writeConfig(`rules:
  - id: a
    field: title
    custom_field: Dept
    check: required
    hint: h
`);
		const { err, io: collector } = io();
		const code = await main(
			["validate"],
			{ SLACK_BOT_TOKEN: "xoxb-test", CONFIG_PATH: path },
			collector,
			() => new FakeSlackDirectory(),
		);
		expect(code).toBe(1);
		expect(err.every((l) => l.startsWith("error: rules[0]"))).toBe(true);
		expect(err.length).toBeGreaterThan(0);
	});

	it("check prints the report", async () => {
		const path = writeConfig(GOOD_CONFIG);
		const fake = new FakeSlackDirectory();
		fake.users = [makeUser({ id: "U1", profile: { hasCustomImage: false } })];
		const { out, io: collector } = io();
		const code = await main(
			["check"],
			{ SLACK_BOT_TOKEN: "xoxb-test", CONFIG_PATH: path },
			collector,
			() => fake,
		);
		expect(code).toBe(0);
		expect(out.join("\n")).toContain("people in scope");
	});

	it("missing token", async () => {
		const { err, io: collector } = io();
		const code = await main(
			["validate"],
			{},
			collector,
			() => new FakeSlackDirectory(),
		);
		expect(code).toBe(1);
		expect(err).toEqual([
			"error: SLACK_BOT_TOKEN is not set (it starts with xoxb-)",
		]);
	});

	it("unknown command", async () => {
		const { err, io: collector } = io();
		const code = await main(
			["nope"],
			{ SLACK_BOT_TOKEN: "xoxb-test" },
			collector,
			() => new FakeSlackDirectory(),
		);
		expect(code).toBe(2);
		expect(err.length).toBeGreaterThan(0);
	});
});
