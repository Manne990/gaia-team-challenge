import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { config } from './config.js';
import { handleApi } from './app.js';
const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
createServer((request, response) => {
  if (handleApi(request, response)) return;
  vite.middlewares(request, response, () => {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
}).listen(config.port, config.host, () =>
  console.log(`Northstar CRM listening at http://${config.host}:${config.port}`),
);
