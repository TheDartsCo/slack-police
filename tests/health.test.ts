import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { startHealthServer } from "../src/health.js";

describe("startHealthServer", () => {
	it("serves /healthz", async () => {
		const server = startHealthServer(0, () => ({ ok: true }));
		try {
			await new Promise<void>((resolve) => server.once("listening", resolve));
			const port = (server.address() as AddressInfo).port;
			const res = await fetch(`http://127.0.0.1:${port}/healthz`);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ ok: true });
			const missing = await fetch(`http://127.0.0.1:${port}/x`);
			expect(missing.status).toBe(404);
		} finally {
			server.close();
		}
	});
});
