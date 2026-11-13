export function slackErrorCode(err: unknown): string | undefined {
	if (typeof err !== "object" || err === null || !("data" in err)) {
		return undefined;
	}
	const data = (err as { data?: unknown }).data;
	if (typeof data !== "object" || data === null || !("error" in data)) {
		return undefined;
	}
	const code = (data as { error?: unknown }).error;
	return typeof code === "string" ? code : undefined;
}
