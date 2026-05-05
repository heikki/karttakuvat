import { serve } from 'bun';

import indexHtml from '../client/index.html';
import { createApiHandler, flushLogBuffer } from './api-routes';
import { createImageCache } from './image-cache';
import { openItemStore } from './item-store';
import { openPhotosLibrary } from './photos-db';
import { createRequestHandler } from './request-handler';

const dataDir = 'data';
const imageCache = createImageCache({ cacheDir: `${dataDir}/cache` });
const photosLibrary = openPhotosLibrary();
const itemStore = openItemStore({ dataDir, imageCache });
itemStore.rebuildComplete
  .then((changed) => {
    console.log(
      changed
        ? '[item-store] Rebuilt: items changed'
        : '[item-store] Rebuilt: no changes'
    );
  })
  .catch((err: unknown) => {
    console.error('[item-store] Rebuild failed:', err);
  });

const { routeApiRequest } = createApiHandler(dataDir, {
  itemStore,
  imageCache,
  photosLibrary
});

const methodColors: Record<string, string> = {
  GET: '\x1b[36m',
  POST: '\x1b[33m',
  PUT: '\x1b[35m',
  DELETE: '\x1b[31m'
};

function logRequest(
  method: string,
  pathname: string,
  status: number,
  ms: number
): void {
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  const methodColor = methodColors[method] ?? '\x1b[37m';
  const statusColor =
    status < 300 ? '\x1b[32m' : status < 400 ? '\x1b[33m' : '\x1b[31m';
  const timing = `${dim}${ms.toFixed(0)}ms${reset}`;
  console.log(
    `  ${methodColor}${method.padEnd(4)}${reset} ${pathname} ${statusColor}${status}${reset} ${timing}`
  );
}

const fetch = createRequestHandler({
  routeApi: routeApiRequest,
  staticRoots: [dataDir, 'src/client'],
  vendorFiles: {
    '/maplibre-gl.css': 'node_modules/maplibre-gl/dist/maplibre-gl.css'
  },
  onResponse: (req, res, pathname, ms) => {
    const isImage = /\.(?:jpe?g|png|gif|webp|avif|svg|ico)$/i.test(pathname);
    if (!isImage || res.status >= 400) {
      logRequest(req.method, pathname, res.status, ms);
    }
    for (const line of flushLogBuffer()) {
      console.log(line);
    }
  }
});

const server = serve({
  routes: { '/': indexHtml },
  development: false,
  fetch
});

console.log(`🚀 Server running on ${server.url.toString()}\n`);
