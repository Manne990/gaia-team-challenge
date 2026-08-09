import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp, errorHandler } from './app.js';
import { loadRuntimeConfig } from '../shared/config.js';

async function start() {
  const config = loadRuntimeConfig();
  const app = createApp(config);
  const isProduction = config.environment === 'production';

  if (isProduction) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const clientDirectory = path.resolve(here, '../../dist/client');
    if (!existsSync(path.join(clientDirectory, 'index.html'))) {
      throw new Error(
        'Production client build is unavailable. Run npm run build before npm run start.',
      );
    }
    app.use(express.static(clientDirectory));
    app.get('*splat', (_request, response) =>
      response.sendFile(path.join(clientDirectory, 'index.html')),
    );
  } else {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  app.use(errorHandler);

  app.listen(config.port, config.host, () => {
    console.log(`Northstar CRM listening on http://${config.host}:${config.port}`);
  });
}

start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unable to start Northstar CRM.');
  process.exitCode = 1;
});
