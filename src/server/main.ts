import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { config } from './config.js';
import { handleApi } from './app.js';
const clientRoot = join(process.cwd(), 'dist', 'client');
createServer((request, response) => {
  if (handleApi(request, response)) return;
  const file = request.url?.startsWith('/assets/')
    ? join(clientRoot, request.url)
    : join(clientRoot, 'index.html');
  if (!existsSync(file)) {
    response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Northstar CRM is unavailable: run npm run build before npm start.');
    return;
  }
  response.writeHead(200, {
    'content-type': file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : 'text/html; charset=utf-8',
  });
  createReadStream(file).pipe(response);
}).listen(config.port, config.host, () =>
  console.log(`Northstar CRM listening at http://${config.host}:${config.port}`),
);
