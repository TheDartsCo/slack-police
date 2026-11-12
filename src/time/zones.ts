export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type WorkingHours = {
	start: string;
	end: string;
	days: readonly Weekday[];
};

const WEEKDAYS: Record<string, Weekday> = {
	Mon: "mon",
	Tue: "tue",
	Wed: "wed",
	Thu: "thu",
	Fri: "fri",
	Sat: "sat",
	Sun: "sun",
};

/** Whether the IANA time zone identifier is recognised by Intl. */
export function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** Weekday and minutes-since-midnight of `now` in the given time zone. */
export function localTime(
	now: Date,
	timeZone: string,
): { weekday: Weekday; minutes: number } {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(now);
	const part = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((p) => p.type === type)?.value ?? "";
	const weekday = WEEKDAYS[part("weekday")];
	if (weekday === undefined) {
		throw new Error(`unexpected weekday for time zone "${timeZone}"`);
	}
	const minutes = Number(part("hour")) * 60 + Number(part("minute"));
	return { weekday, minutes };
}

function toMinutes(hhmm: string): number {
	const [h, m] = hhmm.split(":");
	return Number(h) * 60 + Number(m);
}

/** Whether `now` falls in the working-hours window `[start, end)` on a listed day. */
export function isWithinWorkingHours(
	now: Date,
	timeZone: string,
	wh: WorkingHours,
): boolean {
	const { weekday, minutes } = localTime(now, timeZone);
	if (!wh.days.includes(weekday)) {
		return false;
	}
	return minutes >= toMinutes(wh.start) && minutes < toMinutes(wh.end);
}
