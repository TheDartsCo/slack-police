import { createServer, type Server } from "node:http";

export function startHealthServer(
	port: number,
	status: () => object,
): Server {
	const server = createServer((req, res) => {
		if (req.method === "GET" && req.url === "/healthz") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(status()));
		} else {
			res.writeHead(404);
			res.end();
		}
	});
	server.listen(port);
	return server;
}