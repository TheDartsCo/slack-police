type Unit = "m" | "h" | "d" | "w";

const UNIT_MS: Record<Unit, number> = {
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
};

const UNIT_NAME: Record<Unit, string> = {
	m: "minute",
	h: "hour",
	d: "day",
	w: "week",
};

function invalidDuration(input: string): Error {
	return new Error(`invalid duration "${input}" (use e.g. 30m, 12h, 7d, 2w)`);
}

function parse(input: string): { n: number; unit: Unit } {
	const match = /^(\d+)([mhdw])$/.exec(input);
	if (match === null) {
		throw invalidDuration(input);
	}
	const n = Number(match[1]);
	const unit = match[2] as Unit;
	if (!(n > 0)) {
		throw invalidDuration(input);
	}
	return { n, unit };
}

/** Parse a duration like `30m`, `12h`, `7d`, `2w` into milliseconds. */
export function parseDuration(input: string): number {
	const { n, unit } = parse(input);
	return n * UNIT_MS[unit];
}

/** Human-friendly description: `week` for 1w, otherwise `n units`. */
export function describeDuration(input: string): string {
	const { n, unit } = parse(input);
	const name = UNIT_NAME[unit];
	return n === 1 ? name : `${n} ${name}s`;
}
