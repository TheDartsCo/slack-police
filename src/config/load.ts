import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import {
	type Config,
	ConfigError,
	configSchema,
	formatIssuePath,
} from "./schema.js";

/** Parse and validate YAML config text; throws ConfigError listing every problem. */
export function parseConfigText(text: string): Config {
	const doc = parseDocument(text);
	if (doc.errors.length > 0) {
		throw new ConfigError(
			doc.errors.map(
				(err) => `line ${err.linePos?.[0].line ?? "?"}: ${err.message}`,
			),
		);
	}
	const result = configSchema.safeParse(doc.toJS());
	if (!result.success) {
		throw new ConfigError(
			result.error.issues.map((issue) => {
				const path = formatIssuePath(issue.path);
				return path === "" ? issue.message : `${path}: ${issue.message}`;
			}),
		);
	}
	return result.data;
}

/** Read a YAML config file and validate it. */
export async function loadConfig(path: string): Promise<Config> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		throw new ConfigError([`config file not found: ${path}`]);
	}
	return parseConfigText(text);
}
