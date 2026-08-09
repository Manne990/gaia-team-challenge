import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('browser test exercises the root CRM application and its health boundary accessibly', async ({
  page,
  request,
}) => {
  const port = await freePort();
  const child = spawn('npm', ['run', 'dev'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    await expect
      .poll(async () => {
        try {
          return (await request.get(`${url}/api/health`)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await page.goto(url);
    await expect(
      page.getByRole('heading', { name: /sign in/i }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    child.kill('SIGTERM');
  }
});
