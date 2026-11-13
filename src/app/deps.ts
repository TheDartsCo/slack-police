import type { Config } from "../config/schema.js";
import type { PreparedRule } from "../rules/prepare.js";
import type { SlackDirectory } from "../slack/types.js";
import type { StateStore } from "../state/store.js";
import type { Logger } from "../log.js";

export type AppDeps = {
	dir: SlackDirectory;
	store: StateStore;
	config: Config;
	rules: PreparedRule[];
	log: Logger;
	now: () => Date;
};