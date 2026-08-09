import { createServer } from "node:http";
import { createProductFixtures } from "../fixtures/product-fixtures.mjs";

const html = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Northstar CRM</title><style>body{font-family:system-ui;margin:2rem;max-width:60rem}a,button,input{font:inherit}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #0047ab;outline-offset:3px}.error{color:#b00020}</style></head><body>${body}</body></html>`;
const signInPage = () => html(`<main><h1>Sign in to Northstar CRM</h1><form id="sign-in"><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email"><label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password"><button type="submit">Sign in</button><p id="error" class="error" aria-live="polite"></p></form><script>document.querySelector('#sign-in').addEventListener('submit',async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);const response=await fetch('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(form))});if(response.ok)location='/dashboard';else document.querySelector('#error').textContent='Email or password is incorrect.'})</script></main>`);
const dashboardPage = (user, fixtures) => html(`<header><nav aria-label="Primary"><a href="/dashboard" aria-current="page">Dashboard</a><a href="/companies">Companies</a><button id="sign-out" type="button">Sign out</button></nav></header><main><h1>Dashboard</h1><p>Signed in as ${user.email}</p><section aria-labelledby="company-count"><h2 id="company-count">Companies</h2><p>${fixtures.companies.filter((company) => company.organizationId === user.organizationId).length} accounts</p></section></main><script>document.querySelector('#sign-out').addEventListener('click',async()=>{await fetch('/api/session',{method:'DELETE'});location='/'})</script>`);
const companiesPage = (user, fixtures) => html(`<header><nav aria-label="Primary"><a href="/dashboard">Dashboard</a><a href="/companies" aria-current="page">Companies</a></nav></header><main><h1>Companies</h1><table><caption>Company records</caption><thead><tr><th scope="col">Name</th><th scope="col">Lifecycle</th></tr></thead><tbody>${fixtures.companies.filter((company) => company.organizationId === user.organizationId).map((company) => `<tr><td>${company.name}</td><td>${company.lifecycle}</td></tr>`).join("")}</tbody></table></main>`);
const json = (response, status, value) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};
const readBody = async (request) => new Promise((resolve, reject) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => resolve(body));
  request.on("error", reject);
});
const sessionId = (request) => request.headers.cookie?.match(/northstar_session=([^;]+)/)?.[1];

/** Starts an isolated CRM-shaped server used to verify browser test contracts. */
export async function startBrowserFixtureServer() {
  const fixtures = createProductFixtures();
  const sessions = new Map();
  const server = createServer(async (request, response) => {
    const user = sessions.get(sessionId(request));
    if (request.url === "/" && request.method === "GET") return response.end(signInPage());
    if (request.url === "/api/session" && request.method === "POST") {
      const credentials = JSON.parse(await readBody(request));
      const found = fixtures.users.find((candidate) => candidate.email === credentials.email);
      if (!found || credentials.password !== "OwnerPass!2026") return json(response, 401, { error: "invalid_credentials" });
      const token = `session_${found.id}`;
      sessions.set(token, found);
      response.writeHead(204, { "set-cookie": `northstar_session=${token}; HttpOnly; SameSite=Lax; Path=/` });
      return response.end();
    }
    if (request.url === "/api/session" && request.method === "DELETE") {
      response.writeHead(204, { "set-cookie": "northstar_session=; Max-Age=0; Path=/" });
      return response.end();
    }
    if (!user) return response.writeHead(302, { location: "/" }).end();
    if (request.url === "/dashboard" && request.method === "GET") return response.end(dashboardPage(user, fixtures));
    if (request.url === "/companies" && request.method === "GET") return response.end(companiesPage(user, fixtures));
    const companyMatch = request.url?.match(/^\/api\/companies\/([^/?]+)$/);
    if (companyMatch) {
      const company = fixtures.companies.find((candidate) => candidate.id === companyMatch[1]);
      if (!company || company.organizationId !== user.organizationId) return json(response, 404, { error: "not_found" });
      return json(response, 200, company);
    }
    return json(response, 404, { error: "not_found" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    company: (id) => structuredClone(fixtures.companies.find((candidate) => candidate.id === id)),
    stop: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
