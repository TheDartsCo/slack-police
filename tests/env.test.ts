import { describe, expect, it } from "vitest";
import { readEnv } from "../src/env.js";

describe("readEnv", () => {
	it("requires the bot token", () =>
		expect(() => readEnv({}, { requireAppToken: false })).toThrow(
			"SLACK_BOT_TOKEN is not set (it starts with xoxb-)",
		));

	it("checks the prefix", () =>
		expect(() =>
			readEnv({ SLACK_BOT_TOKEN: "abc" }, { requireAppToken: false }),
		).toThrow("SLACK_BOT_TOKEN should start with xoxb-"));

	it("requires the app token for start", () =>
		expect(() =>
			readEnv({ SLACK_BOT_TOKEN: "xoxb-1" }, { requireAppToken: true }),
		).toThrow("SLACK_APP_TOKEN is not set (it starts with xapp-)"));

	it("defaults", () =>
		expect(
			readEnv({ SLACK_BOT_TOKEN: "xoxb-1" }, { requireAppToken: false }),
		).toEqual({
			botToken: "xoxb-1",
			appToken: undefined,
			configPath: "./config.yaml",
			dataDir: "./data",
			logLevel: "info",
			healthPort: undefined,
		}));

	it("rejects a non-numeric HEALTH_PORT", () =>
		expect(() =>
			readEnv(
				{ SLACK_BOT_TOKEN: "xoxb-1", HEALTH_PORT: "x" },
				{ requireAppToken: false },
			),
		).toThrow("HEALTH_PORT must be a port number"));
});
