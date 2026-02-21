import { join, resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const { BrowserView, BrowserWindow, ApplicationMenu } = await import(
  'electrobun/bun'
);

const { createApiHandler, flushLogBuffer } = await import('../../api-routes');
type AppRPC = typeof import('../rpc-types').AppRPC;

// Detect dev build from version.json
const resourcesDir = resolve(dirname(process.argv0), '..', 'Resources');
let isDev = false;
try {
  const versionInfo = await Bun.file(join(resourcesDir, 'version.json')).json();
  isDev = versionInfo.channel === 'dev';
} catch {
  // ignore
}

// Data directory: in dev builds, use public/ next to the project root
function findDataDir(): string {
  if (process.env.KARTTAKUVAT_DATA_DIR) {
    return resolve(process.env.KARTTAKUVAT_DATA_DIR);
  }

  if (isDev) {
    // Walk up from the build dir to find the project root (where public/ lives)
    const projectRoot = resolve(resourcesDir, '..', '..', '..', '..', '..');
    const publicDir = join(projectRoot, 'public');
    if (existsSync(publicDir)) {
      return publicDir;
    }
  }

  return join(process.env.HOME!, 'Library/Application Support/Karttakuvat');
}

const dataDir = findDataDir();
console.log(`[main] Data directory: ${dataDir}`);

const { routeApiRequest } = createApiHandler(dataDir);

// Locate bundled view files
const appDir = join(resourcesDir, 'app');
const viewsDir = join(appDir, 'views', 'app');

// App menu with Cmd+Q
ApplicationMenu.setApplicationMenu([
  {
    label: 'Karttakuvat',
    submenu: [
      { label: 'About Karttakuvat', action: 'about' },
      { type: 'divider' },
      { label: 'Quit Karttakuvat', action: 'quit', accelerator: 'CmdOrCtrl+Q' }
    ]
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo', accelerator: 'CmdOrCtrl+Z' },
      { role: 'redo', accelerator: 'CmdOrCtrl+Shift+Z' },
      { type: 'divider' },
      { role: 'cut', accelerator: 'CmdOrCtrl+X' },
      { role: 'copy', accelerator: 'CmdOrCtrl+C' },
      { role: 'paste', accelerator: 'CmdOrCtrl+V' },
      { role: 'selectAll', accelerator: 'CmdOrCtrl+A' }
    ]
  },
  {
    label: 'Window',
    submenu: [
      { role: 'minimize', accelerator: 'CmdOrCtrl+M' },
      { role: 'close', accelerator: 'CmdOrCtrl+W' }
    ]
  }
]);

// Handle menu actions
ApplicationMenu.on('application-menu-clicked', (event: any) => {
  const action = event?.detail?.action ?? '';
  if (action.includes('quit')) {
    process.exit(0);
  }
});

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
