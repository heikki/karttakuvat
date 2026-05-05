/**
 * E2E test server.
 *
 * Boots the same API handler and routing the production server uses, but
 * against a tempdir-backed item store pre-seeded with fake items so no Apple
 * Photos library access is required.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from 'bun';

import indexHtml from '../src/client/index.html';
import { createApiHandler } from '../src/server/api-routes';
import { openItemStore, type ItemEntry } from '../src/server/item-store';
import {
  createImageCache,
  type PhotosLibrary
} from '../src/server/photos-library';
import { createRequestHandler } from '../src/server/request-handler';

const port = Number(process.env.E2E_PORT ?? 4757);
const dataDir = process.env.E2E_DATA_DIR ?? 'e2e/.data';

mkdirSync(dataDir, { recursive: true });
mkdirSync(`${dataDir}/cache`, { recursive: true });

const seed = (
  uuid: string,
  date: string,
  albums: string[],
  camera: string
): ItemEntry => ({
  uuid,
  type: 'photo',
  full: `full/${uuid}.jpg`,
  thumb: `thumb/${uuid}.jpg`,
  lat: 60.17,
  lon: 24.94,
  date,
  tz: '+03:00',
  camera,
  gps: 'exif',
  gps_accuracy: 5,
  albums,
  photos_url: ''
});

// Mixed years/albums/cameras so cascade tests have something to narrow.
// Date format matches photos-db output ("YYYY:MM:DD HH:MM:SS") so the
// client's getYear() can split on the first colon.
const items: ItemEntry[] = [
  seed('e2e-1', '2024:06:01 12:00:00', ['Helsinki'], 'iPhone'),
  seed('e2e-2', '2023:08:15 10:00:00', ['Tampere'], 'Sony'),
  seed('e2e-3', '2024:09:20 14:00:00', ['Tampere'], 'iPhone')
];

// Pre-seed the snapshot so /api/items returns immediately. The buildFreshItems
// override returns the same list so rebuild detects no changes — no Apple
// Photos library is touched.
writeFileSync(join(dataDir, 'items.json'), JSON.stringify(items));

const imageCache = createImageCache({ cacheDir: `${dataDir}/cache` });
const itemStore = openItemStore({
  dataDir,
  imageCache,
  buildFreshItems: () => items
});
itemStore.rebuildComplete.catch(() => {
  /* ignored — E2E doesn't depend on rebuild */
});

// E2E doesn't touch the real Photos library; image/metadata routes aren't exercised.
const photosLibrary: PhotosLibrary = {
  resolveImagePath: () => null,
  resolveVideoPath: () => null,
  getMetadata: () => null
};

const { routeApiRequest } = createApiHandler(dataDir, {
  itemStore,
  photosLibrary
});

const fetch = createRequestHandler({
  routeApi: routeApiRequest,
  staticRoots: [dataDir, 'src/client']
});

serve({
  port,
  routes: { '/': indexHtml },
  development: false,
  fetch
});

console.log(`E2E server listening on http://127.0.0.1:${port}`);
