import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseConfigText } from "../src/config/load.js";

describe("packaging", () => {
	it("example config parses, is dry-run, and shows pilot mode", () => {
		const text = readFileSync("config.example.yaml", "utf8");
		expect(parseConfigText(text).dry_run).toBe(true);
		expect(text).toContain("# only_users:");
	});

	it("manifest has exactly the documented scopes and Socket Mode", () => {
		const m = parse(readFileSync("manifest.yaml", "utf8"));
		expect([...m.oauth_config.scopes.bot].toSorted()).toEqual([
			"chat:write",
			"im:write",
			"users.profile:read",
			"users:read",
			"users:read.email",
		]);
		expect(m.settings.socket_mode_enabled).toBe(true);
		expect(m.features.app_home.messages_tab_read_only_enabled).toBe(true);
		expect(m.features.bot_user.display_name).toBe("Profile Check");
	});
});
