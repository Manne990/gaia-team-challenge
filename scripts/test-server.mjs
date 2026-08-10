import { createServer } from "node:http";

const port = Number(process.env.TEST_PORT);
if (!Number.isInteger(port) || port < 1) throw new Error("TEST_PORT must be an allocated port");

const companies = Array.from({ length: 37 }, (_, index) => ({
  id: `company_${index + 1}`,
  organizationId: index === 36 ? "outside" : "northstar",
  name: index < 2 ? "Acme Group" : `Company ${index + 1}`,
}));
const sessions = new Set();
const document = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Northstar CRM</title></head><body>${body}</body></html>`;
const signIn = () => document(`<main><h1>Sign in to Northstar CRM</h1><form method="post" action="/session"><label>Email <input name="email" type="email" autocomplete="email" required></label><label>Password <input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button></form></main>`);
const dashboard = () => document(`<nav aria-label="Primary"><a href="/dashboard" aria-current="page">Dashboard</a><a href="/companies">Companies</a></nav><main><h1>Dashboard</h1><p>36 companies</p></main>`);
const companyList = () => document(`<nav aria-label="Primary"><a href="/dashboard">Dashboard</a><a href="/companies" aria-current="page">Companies</a></nav><main><h1>Companies</h1><table><caption>Company records</caption><thead><tr><th scope="col">Name</th></tr></thead><tbody>${companies.filter(({ organizationId }) => organizationId === "northstar").map(({ name }) => `<tr><td>${name}</td></tr>`).join("")}</tbody></table></main>`);

function body(request) {
  return new Promise((resolve, reject) => {
    let value = "";
    request.on("data", (chunk) => { value += chunk; });
    request.once("end", () => resolve(value));
    request.once("error", reject);
  });
}

const server = createServer(async (request, response) => {
  const session = request.headers.cookie?.match(/northstar_test=([^;]+)/)?.[1];
  const authenticated = session && sessions.has(session);
  if (request.method === "GET" && request.url === "/") return response.end(signIn());
  if (request.method === "POST" && request.url === "/session") {
    const credentials = new URLSearchParams(await body(request));
    if (credentials.get("email") !== "owner@northstar.test" || credentials.get("password") !== "OwnerPass!2026") {
      response.writeHead(401, { "content-type": "text/html; charset=utf-8" });
      return response.end(signIn());
    }
    const token = "fixture-owner-session";
    sessions.add(token);
    response.writeHead(303, { location: "/dashboard", "set-cookie": `northstar_test=${token}; HttpOnly; SameSite=Lax; Path=/` });
    return response.end();
  }
  if (!authenticated) {
    response.writeHead(303, { location: "/" });
    return response.end();
  }
  if (request.method === "GET" && request.url === "/dashboard") return response.end(dashboard());
  if (request.method === "GET" && request.url === "/companies") return response.end(companyList());
  const companyId = request.url?.match(/^\/api\/companies\/([^/]+)$/)?.[1];
  if (request.method === "GET" && companyId) {
    const company = companies.find(({ id }) => id === companyId && companyId !== "company_37");
    response.writeHead(company ? 200 : 404, { "content-type": "application/json" });
    return response.end(JSON.stringify(company ?? { error: "not_found" }));
  }
  response.writeHead(404).end();
});

server.listen(port, "127.0.0.1", () => console.log(`test server listening on ${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
