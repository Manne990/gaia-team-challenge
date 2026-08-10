import { createServer } from "node:http";

const port = Number(process.env.TEST_PORT);
if (!Number.isInteger(port) || port < 1) throw new Error("TEST_PORT must be an allocated port");

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en"><head><title>Northstar test probe</title></head><body><main><h1>Northstar CRM</h1><p>Deterministic browser harness</p></main></body></html>`);
});

server.listen(port, "127.0.0.1", () => console.log(`test server listening on ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
