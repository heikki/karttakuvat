import { join, resolve, dirname } from 'node:path';

const { BrowserView, BrowserWindow } = await import('electrobun/bun');

const { createApiHandler, flushLogBuffer } = await import('../../api-routes');
type AppRPC = typeof import('../rpc-types').AppRPC;

// Data directory: env override or default Application Support location
const dataDir = resolve(
  process.env.KARTTAKUVAT_DATA_DIR ??
    join(process.env.HOME!, 'Library/Application Support/Karttakuvat')
);

console.log(`[main] Data directory: ${dataDir}`);

const { routeApiRequest } = createApiHandler(dataDir);

// Locate bundled view files
const appDir = resolve(dirname(process.argv0), '..', 'Resources', 'app');
const viewsDir = join(appDir, 'views', 'app');

// Start local server that serves both API and view files
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);

    // API routes
    const apiResponse = routeApiRequest(req, url.pathname);
    if (apiResponse !== null) {
      const response = await apiResponse;
      for (const line of flushLogBuffer()) {
        console.log(line);
      }
      return response;
    }

    // Serve bundled view files (index.html, index.js, CSS)
    const decodedPath = decodeURIComponent(url.pathname);

    if (decodedPath === '/' || decodedPath === '/index.html') {
      return new Response(Bun.file(join(viewsDir, 'index.html')));
    }

    const viewFile = Bun.file(join(viewsDir, decodedPath));
    if (viewFile.size > 0) {
      return new Response(viewFile);
    }

    // Serve static files from data directory (photos, thumbnails, GPX, items.json)
    const dataFile = Bun.file(join(dataDir, decodedPath));
    if (dataFile.size > 0) {
      return new Response(dataFile);
    }

    return new Response('Not Found', { status: 404 });
  }
});

const baseUrl = `http://127.0.0.1:${server.port}`;
console.log(`[main] Server running on ${baseUrl}`);

// Create browser window
const rpc = BrowserView.defineRPC<AppRPC>({
  handlers: {
    requests: {},
    messages: {}
  }
});

const win = new BrowserWindow<typeof rpc>({
  title: 'Karttakuvat',
  url: baseUrl,
  frame: { x: 0, y: 0, width: 1200, height: 800 },
  rpc
});

console.log('[main] Initialization complete');
