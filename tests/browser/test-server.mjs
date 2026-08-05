import { createServer } from 'node:http';
import { createCrmFixtures } from '../fixtures/crm-fixtures.mjs';

const port = Number(process.env.TEST_PORT);
if (!Number.isInteger(port)) throw new Error('TEST_PORT is required');
const fixtures = createCrmFixtures();
const companyCount = fixtures.companies.filter(
  (company) => company.organizationId === 'org_northstar_demo',
).length;

createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (request.url === '/dashboard') {
    response.end(
      `<main><h1>Northstar CRM</h1><p>Dashboard</p><p>${companyCount} accounts</p></main>`,
    );
    return;
  }
  response.end(
    `<!doctype html><main><h1>Northstar CRM sign in</h1><label>Email <input name="email" type="email"></label><label>Password <input name="password" type="password"></label><button onclick="location.href='/dashboard'">Sign in</button></main>`,
  );
}).listen(port, '127.0.0.1');
