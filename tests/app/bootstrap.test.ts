import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bootstrap } from "../../src/app/bootstrap.js";
import { FakeSlackDirectory, makeUser } from "../support/fake-directory.js";

const dir = mkdtempSync(join(tmpdir(), "slack-police-bootstrap-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeConfig(yaml: string): string {
	const path = join(dir, `config-${Math.random().toString(36).slice(2)}.yaml`);
	writeFileSync(path, yaml);
	return path;
}

describe("bootstrap", () => {
	it("returns team name, prepared rules and ref warnings", async () => {
		const path = writeConfig(`scope:
  exclude_users: [x@y.com]
rules:
  - id: photo
    field: photo
    check: required
    hint: Upload a photo.
    only_users: [U2]
`);
		const fake = new FakeSlackDirectory();
		fake.users = [makeUser({ id: "U2", deleted: true })];
		const result = await bootstrap(path, fake);
		expect(result.teamName).toBe("Acme");
		expect(result.rules).toHaveLength(1);
		expect(result.warnings).toEqual([
			'scope.exclude_users: "x@y.com" matches nobody in this workspace',
			'rules[0].only_users: "U2" is a deactivated account',
		]);
	});

	it("bad token", async () => {
		const path = writeConfig(`rules:
  - id: photo
    field: photo
    check: required
    hint: Upload a photo.
`);
		const fake = new FakeSlackDirectory();
		fake.authError = { data: { error: "invalid_auth" } };
		await expect(bootstrap(path, fake)).rejects.toThrow(
			"Slack rejected SLACK_BOT_TOKEN: invalid_auth",
		);
	});
});
