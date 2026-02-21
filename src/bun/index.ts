import { join } from 'node:path';

const { BrowserView, BrowserWindow } = await import('electrobun/bun');

const { createApiHandler, flushLogBuffer } = await import('../../api-routes');
type AppRPC = typeof import('../rpc-types').AppRPC;

// Data directory: env override or default Application Support location
const dataDir =
  process.env.KARTTAKUVAT_DATA_DIR ??
  join(process.env.HOME!, 'Library/Application Support/Karttakuvat');

console.log(`[main] Data directory: ${dataDir}`);

const { routeApiRequest } = createApiHandler(dataDir);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function addCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// Start local API server on a random port
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // API routes
    const apiResponse = routeApiRequest(req, url.pathname);
    if (apiResponse !== null) {
      const response = await apiResponse;
      for (const line of flushLogBuffer()) {
        console.log(line);
      }
      return addCors(response);
    }

    // Serve static files from data directory (photos, thumbnails, GPX, items.json)
    const decodedPath = decodeURIComponent(url.pathname);
    const file = Bun.file(join(dataDir, decodedPath));
    if (file.size > 0) {
      return addCors(new Response(file));
    }

    return addCors(new Response('Not Found', { status: 404 }));
  }
});

const apiBase = `http://127.0.0.1:${server.port}`;
console.log(`[main] API server running on ${apiBase}`);

// Create browser window with RPC
const rpc = BrowserView.defineRPC<AppRPC>({
  handlers: {
    requests: {},
    messages: {}
  }
});

const win = new BrowserWindow<typeof rpc>({
  title: 'Karttakuvat',
  url: 'views://app/index.html',
  frame: { x: 0, y: 0, width: 1200, height: 800 },
  rpc
});

// Send the API base URL to the webview
win.webview.rpc!.send.setApiBase({ url: apiBase });

console.log('[main] Initialization complete');
