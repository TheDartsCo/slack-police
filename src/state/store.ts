import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type PersonState = {
	userId: string;
	lastRemindedAt: number | null;
	reminderCount: number;
	dmChannelId: string | null;
	lastMessageTs: string | null;
	lastFailures: string[];
	updatedAt: number;
};

export interface StateStore {
	get(userId: string): PersonState | undefined;
	recordReminder(
		userId: string,
		r: {
			at: Date;
			dmChannelId: string;
			messageTs: string;
			failures: string[];
		},
	): void;
	markCompliant(userId: string, at: Date): void;
	close(): void;
}

type Row = {
	user_id: string;
	last_reminded_at: number | null;
	reminder_count: number;
	dm_channel_id: string | null;
	last_message_ts: string | null;
	last_failures: string;
	updated_at: number;
};

function toState(row: Row): PersonState {
	return {
		userId: row.user_id,
		lastRemindedAt: row.last_reminded_at,
		reminderCount: row.reminder_count,
		dmChannelId: row.dm_channel_id,
		lastMessageTs: row.last_message_ts,
		lastFailures: JSON.parse(row.last_failures) as string[],
		updatedAt: row.updated_at,
	};
}

export function openStateStore(path: string): StateStore {
	if (path !== ":memory:") {
		mkdirSync(dirname(path), { recursive: true });
	}
	const db = new Database(path);
	db.exec(`
		CREATE TABLE IF NOT EXISTS people (
			user_id TEXT PRIMARY KEY,
			last_reminded_at INTEGER,
			reminder_count INTEGER NOT NULL DEFAULT 0,
			dm_channel_id TEXT,
			last_message_ts TEXT,
			last_failures TEXT NOT NULL DEFAULT '[]',
			updated_at INTEGER NOT NULL
		)
	`);

	const getRow = db.prepare("SELECT * FROM people WHERE user_id = ?");
	const upsertReminder = db.prepare(`
		INSERT INTO people (user_id, last_reminded_at, reminder_count, dm_channel_id, last_message_ts, last_failures, updated_at)
		VALUES (@userId, @at, 1, @dmChannelId, @messageTs, @failures, @at)
		ON CONFLICT(user_id) DO UPDATE SET
			last_reminded_at = excluded.last_reminded_at,
			reminder_count = people.reminder_count + 1,
			dm_channel_id = excluded.dm_channel_id,
			last_message_ts = excluded.last_message_ts,
			last_failures = excluded.last_failures,
			updated_at = excluded.updated_at
	`);
	const upsertCompliant = db.prepare(`
		INSERT INTO people (user_id, last_reminded_at, reminder_count, last_failures, updated_at)
		VALUES (@userId, NULL, 0, '[]', @at)
		ON CONFLICT(user_id) DO UPDATE SET
			last_reminded_at = NULL,
			reminder_count = 0,
			last_failures = '[]',
			updated_at = excluded.updated_at
	`);

	return {
		get(userId) {
			const row = getRow.get(userId) as Row | undefined;
			return row === undefined ? undefined : toState(row);
		},
		recordReminder(userId, r) {
			upsertReminder.run({
				userId,
				at: r.at.getTime(),
				dmChannelId: r.dmChannelId,
				messageTs: r.messageTs,
				failures: JSON.stringify(r.failures),
			});
		},
		markCompliant(userId, at) {
			upsertCompliant.run({ userId, at: at.getTime() });
		},
		close() {
			db.close();
		},
	};
}

export function isDue(
	state: PersonState | undefined,
	now: Date,
	everyMs: number,
): boolean {
	if (state === undefined || state.lastRemindedAt === null) {
		return true;
	}
	return now.getTime() - state.lastRemindedAt >= everyMs;
}