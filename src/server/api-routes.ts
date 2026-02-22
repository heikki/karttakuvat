import {
  deleteAlbumFile,
  getAlbumFiles,
  getAllItems,
  setFileVisible,
  updateItemDate,
  updateItemLocation
} from './app-db';
import type { ImageCache } from './image-cache';
import type { ItemEntry } from './items';
import {
  openPhotosDb,
  queryAssetIndex,
  queryMetadata,
  type AssetRecord
} from './photos-db';
import {
  quitPhotosApp,
  setDateTime,
  setLocation,
  setTimezone,
  tzNameFromCoords,
  tzOffsetFromCoords,
  tzOffsetToSeconds
} from './photos-edit';

export interface LocationEdit {
  uuid: string;
  lat: number;
  lon: number;
}

export interface TimeEdit {
  uuid: string;
  hours: number;
}

interface SetLocationsBody {
  edits: LocationEdit[];
  timeEdits?: TimeEdit[];
}

type ItemRecord = Pick<
  ItemEntry,
  'uuid' | 'date' | 'tz' | 'lat' | 'lon' | 'gps' | 'gps_accuracy'
>;

const datePattern =
  /^(?<yr>\d{4}):(?<mo>\d{2}):(?<dy>\d{2}) (?<hr>\d{2}):(?<mi>\d{2}):(?<sc>\d{2})$/v;

function applyHourOffset(dateStr: string, hours: number): string {
  if (dateStr === '' || hours === 0) return dateStr;
  const match = datePattern.exec(dateStr);
  if (match?.groups === undefined) return dateStr;
  const { yr, mo, dy, hr, mi, sc } = match.groups;
  const d = new Date(
    parseInt(yr!, 10),
    parseInt(mo!, 10) - 1,
    parseInt(dy!, 10),
    parseInt(hr!, 10),
    parseInt(mi!, 10),
    parseInt(sc!, 10)
  );
  d.setTime(d.getTime() + Math.round(hours * 3600000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const scriptLogBuffer: string[] = [];

function logEditResult(label: string, uuid: string, error?: string): void {
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  if (error === undefined) {
    scriptLogBuffer.push(`    ${label} ${dim}${uuid}${reset}`);
  } else {
    scriptLogBuffer.push(
      `    ${label} \x1b[31m✗${reset} ${dim}${uuid}${reset}\n         ${dim}${error}${reset}`
    );
  }
}

export function flushLogBuffer(): string[] {
  const lines = scriptLogBuffer.splice(0);
  return lines;
}

function tzOffsetHours(tz: string | null): number {
  if (tz === null || tz === '') return 0;
  const sign = tz.startsWith('+') ? 1 : -1;
  const h = parseInt(tz.slice(1, 3), 10);
  const m = parseInt(tz.slice(4, 6), 10);
  return sign * (h + m / 60);
}

function applyLocationEdits(
  items: ItemRecord[],
  edits: LocationEdit[],
  tzResults: Map<string, string | null>
) {
  for (const edit of edits) {
    const item = items.find((i) => i.uuid === edit.uuid);
    if (item !== undefined) {
      item.lat = edit.lat;
      item.lon = edit.lon;
      item.gps = 'user';
      item.gps_accuracy = 1;
      const newTz = tzResults.get(edit.uuid);
      if (newTz !== undefined && newTz !== item.tz) {
        const oldOffset = tzOffsetHours(item.tz);
        const newOffset = tzOffsetHours(newTz);
        item.date = applyHourOffset(item.date, newOffset - oldOffset);
        item.tz = newTz;
      }
    }
  }
}

function applyTimeEdits(items: ItemRecord[], edits: TimeEdit[]) {
  for (const edit of edits) {
    const item = items.find((i) => i.uuid === edit.uuid);
    if (item !== undefined) {
      item.date = applyHourOffset(item.date, edit.hours);
    }
  }
}

// eslint-disable-next-line complexity -- sequential edits with tz lookup
function processLocationEdits(
  edits: LocationEdit[],
  itemsByUuid: Map<string, ItemRecord>
): { error?: Response; tzResults: Map<string, string | null> } {
  const tzResults = new Map<string, string | null>();
  if (edits.length === 0) return { tzResults };

  for (const edit of edits) {
    const item = itemsByUuid.get(edit.uuid);
    try {
      setLocation(edit.uuid, edit.lat, edit.lon);

      const dateStr = item?.date ?? '';
      const oldTz = item?.tz ?? null;
      const tzName = tzNameFromCoords(edit.lat, edit.lon);
      const newTz = tzOffsetFromCoords(edit.lat, edit.lon, dateStr);

      if (tzName !== null && newTz !== null && newTz !== oldTz) {
        const offsetSec = tzOffsetToSeconds(newTz);
        setTimezone(edit.uuid, tzName, offsetSec);
      }

      tzResults.set(edit.uuid, newTz);
      logEditResult('📍', edit.uuid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logEditResult('📍', edit.uuid, msg);
    }
  }

  return { tzResults };
}

function processTimeEdits(
  edits: TimeEdit[],
  itemsByUuid: Map<string, ItemRecord>
): Response | null {
  if (edits.length === 0) return null;

  for (const edit of edits) {
    const item = itemsByUuid.get(edit.uuid);
    if (item === undefined) continue;
    const target = applyHourOffset(item.date, edit.hours);
    const [datePart, timePart] = target.split(' ');
    if (datePart === undefined || timePart === undefined) continue;

    try {
      setDateTime(edit.uuid, datePart.replaceAll(':', '-'), timePart);
      logEditResult('⏰', edit.uuid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logEditResult('⏰', edit.uuid, msg);
    }
  }

  return null;
}

export interface ApiHandlerOptions {
  imageCache?: ImageCache;
}

/**
 * Create API route handler parameterized by data directory.
 * The dataDir should contain app.db, full/, thumb/, albums/.
 */
export function createApiHandler(
  dataDir: string,
  options: ApiHandlerOptions = {}
) {
  const { imageCache } = options;
  let photosDb: ReturnType<typeof openPhotosDb> | null = null;
  let assetIndex: Map<string, AssetRecord> | null = null;

  function getPhotosDb() {
    photosDb ??= openPhotosDb();
    return photosDb;
  }

  function getAssetIndex(): Map<string, AssetRecord> {
    if (assetIndex === null) {
      assetIndex = queryAssetIndex(getPhotosDb());
      console.log(
        `[image-cache] Loaded ${assetIndex.size} assets from Photos.sqlite`
      );
    }
    return assetIndex;
  }

  /** Invalidate the in-memory asset index so it reloads on next request. */
  function reloadAssetIndex(): void {
    assetIndex = null;
  }

  async function handleUploadAlbumFile(
    req: Request,
    album: string
  ): Promise<Response> {
    try {
      const { mkdir } = await import('node:fs/promises');
      const dir = `${dataDir}/albums/${album}`;
      await mkdir(dir, { recursive: true });

      const formData = await req.formData();
      const results: string[] = [];

      const writes = formData
        .getAll('file')
        .filter((value): value is File => {
          if (!(value instanceof File)) return false;
          const name = value.name.toLowerCase();
          return name.endsWith('.gpx') || name.endsWith('.md');
        })
        .map(async (file) => {
          const bytes = await file.arrayBuffer();
          await Bun.write(`${dir}/${file.name}`, bytes);
          return file.name;
        });
      results.push(...(await Promise.all(writes)));

      if (results.length === 0) {
        return new Response('No valid files (.gpx, .md) in upload', {
          status: 400
        });
      }

      return Response.json({ ok: true, files: results });
    } catch (err) {
      console.error('handleUploadAlbumFile error:', err);
      return new Response(`Server error: ${String(err)}`, { status: 500 });
    }
  }

  async function handleGetGpxFiles(album: string): Promise<Response> {
    try {
      const { readdir } = await import('node:fs/promises');
      const dir = `${dataDir}/albums/${album}`;
      const entries = await readdir(dir).catch(() => [] as string[]);
      const gpxFiles = entries.filter((f) => f.toLowerCase().endsWith('.gpx'));
      return Response.json(gpxFiles);
    } catch {
      return Response.json([]);
    }
  }

  async function handleGetAlbumFiles(album: string): Promise<Response> {
    try {
      const { readdir } = await import('node:fs/promises');
      const dir = `${dataDir}/albums/${album}`;
      const entries = await readdir(dir).catch(() => [] as string[]);
      const files = entries.filter((f) => {
        const lower = f.toLowerCase();
        return lower.endsWith('.gpx') || lower.endsWith('.md');
      });
      const dbInfo = getAlbumFiles(album);
      const result = files.map((f) => ({
        name: f,
        visible: dbInfo.get(f)?.visible ?? true
      }));
      return Response.json(result);
    } catch {
      return Response.json([]);
    }
  }

  async function handleDeleteAlbumFile(
    album: string,
    filename: string
  ): Promise<Response> {
    try {
      const { unlink } = await import('node:fs/promises');
      const filePath = `${dataDir}/albums/${album}/${filename}`;
      await unlink(filePath);
      deleteAlbumFile(album, filename);
      return Response.json({ ok: true });
    } catch (err) {
      console.error('handleDeleteAlbumFile error:', err);
      return new Response(`Server error: ${String(err)}`, { status: 500 });
    }
  }

  function handleSetFileVisibility(
    album: string,
    filename: string,
    req: Request
  ): Promise<Response> {
    return req
      .json()
      .then((body: unknown) => {
        const { visible } = body as { visible: boolean };
        setFileVisible(album, filename, visible);
        return Response.json({ ok: true });
      })
      .catch((err: unknown) => {
        console.error('handleSetFileVisibility error:', err);
        return new Response(`Server error: ${String(err)}`, { status: 500 });
      });
  }

  function handleGetMetadata(uuid: string): Response {
    try {
      const record = queryMetadata(getPhotosDb(), uuid);
      if (record === null) {
        return new Response('Not found', { status: 404 });
      }
      return Response.json(record);
    } catch (err) {
      return new Response(`Error: ${String(err)}`, { status: 500 });
    }
  }

  // eslint-disable-next-line complexity -- sequential edit pipeline
  async function handleSaveEdits(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as SetLocationsBody;
      const locationEdits = Array.isArray(body.edits) ? body.edits : [];
      const timeEdits = Array.isArray(body.timeEdits) ? body.timeEdits : [];

      if (locationEdits.length === 0 && timeEdits.length === 0) {
        return new Response('No edits provided', { status: 400 });
      }

      // Build in-memory lookup from DB for tz computation during edits
      const allItems = getAllItems();
      const itemsByUuid = new Map<string, ItemRecord>(
        allItems.map((i) => [i.uuid, i])
      );

      const locResult = processLocationEdits(locationEdits, itemsByUuid);
      if (locResult.error !== undefined) return locResult.error;

      const timeError = processTimeEdits(timeEdits, itemsByUuid);
      if (timeError !== null) return timeError;

      if (locationEdits.length > 0 || timeEdits.length > 0) {
        quitPhotosApp();
      }

      // Apply edits to in-memory items, then persist to DB
      const editedItems = [...itemsByUuid.values()];
      applyLocationEdits(editedItems, locationEdits, locResult.tzResults);
      applyTimeEdits(editedItems, timeEdits);

      // Persist each edited item to DB
      for (const edit of locationEdits) {
        const item = itemsByUuid.get(edit.uuid);
        if (item !== undefined) {
          updateItemLocation({
            uuid: item.uuid,
            lat: item.lat!,
            lon: item.lon!,
            gps: item.gps ?? 'user',
            gpsAccuracy: item.gps_accuracy ?? 1,
            tz: item.tz,
            date: item.date
          });
        }
      }
      for (const edit of timeEdits) {
        const item = itemsByUuid.get(edit.uuid);
        if (item !== undefined) {
          updateItemDate(item.uuid, item.date);
        }
      }

      return Response.json({ ok: true });
    } catch (err) {
      console.error('handleSaveEdits error:', err);
      return new Response(`Server error: ${String(err)}`, { status: 500 });
    }
  }

  /** Serve an image via on-demand conversion + cache. */
  function handleImageRequest(
    uuid: string,
    size: 'full' | 'thumb'
  ): Response | null {
    if (imageCache === undefined) return null;

    const asset = getAssetIndex().get(uuid);
    if (asset === undefined) return null;

    try {
      const cachedPath = imageCache.resolve(uuid, size, asset);
      if (cachedPath === null) return null;
      return new Response(Bun.file(cachedPath));
    } catch (err) {
      console.error(`[image-cache] Error resolving ${size}/${uuid}:`, err);
      return null;
    }
  }

  /** Route an API request. Returns null if the path doesn't match any API route. */
  // eslint-disable-next-line complexity -- routing dispatch with multiple patterns
  function routeApiRequest(
    req: Request,
    pathname: string
  ): Promise<Response | null> | Response | null {
    if (pathname === '/api/items' && req.method === 'GET') {
      return Response.json(getAllItems());
    }

    if (pathname === '/api/save-edits' && req.method === 'POST') {
      return handleSaveEdits(req);
    }

    const uploadMatch = /^\/api\/albums\/(?<album>.+)\/upload$/.exec(pathname);
    if (uploadMatch?.groups !== undefined && req.method === 'POST') {
      return handleUploadAlbumFile(
        req,
        decodeURIComponent(uploadMatch.groups.album!)
      );
    }

    const gpxMatch = /^\/api\/gpx\/(?<album>.+)$/.exec(pathname);
    if (gpxMatch?.groups !== undefined && req.method === 'GET') {
      return handleGetGpxFiles(decodeURIComponent(gpxMatch.groups.album!));
    }

    const albumFilesMatch = /^\/api\/albums\/(?<album>[^/]+)\/files$/.exec(
      pathname
    );
    if (albumFilesMatch?.groups !== undefined && req.method === 'GET') {
      return handleGetAlbumFiles(
        decodeURIComponent(albumFilesMatch.groups.album!)
      );
    }

    const visibilityMatch =
      /^\/api\/albums\/(?<album>[^/]+)\/files\/(?<filename>[^/]+)\/visibility$/.exec(
        pathname
      );
    if (visibilityMatch?.groups !== undefined && req.method === 'PUT') {
      return handleSetFileVisibility(
        decodeURIComponent(visibilityMatch.groups.album!),
        decodeURIComponent(visibilityMatch.groups.filename!),
        req
      );
    }

    const deleteFileMatch =
      /^\/api\/albums\/(?<album>[^/]+)\/files\/(?<filename>[^/]+)$/.exec(
        pathname
      );
    if (deleteFileMatch?.groups !== undefined && req.method === 'DELETE') {
      return handleDeleteAlbumFile(
        decodeURIComponent(deleteFileMatch.groups.album!),
        decodeURIComponent(deleteFileMatch.groups.filename!)
      );
    }

    const metadataMatch = /^\/api\/metadata\/(?<id>[A-F0-9-]+)$/i.exec(
      pathname
    );
    if (metadataMatch?.groups !== undefined && req.method === 'GET') {
      return handleGetMetadata(metadataMatch.groups.id!);
    }

    // On-demand image serving: /full/{uuid}.jpg and /thumb/{uuid}.jpg
    if (imageCache !== undefined && req.method === 'GET') {
      const imageMatch =
        /^\/(?<size>full|thumb)\/(?<id>[A-F0-9-]+)\.jpg$/i.exec(pathname);
      if (imageMatch?.groups !== undefined) {
        return handleImageRequest(
          imageMatch.groups.id!,
          imageMatch.groups.size! as 'full' | 'thumb'
        );
      }
    }

    return null;
  }

  /** Route a request: try API routes first, then serve static files from dataDir. */
  async function routeRequest(req: Request, url: URL): Promise<Response> {
    const apiResponse = routeApiRequest(req, url.pathname);
    if (apiResponse !== null) {
      const resolved = await apiResponse;
      if (resolved !== null) return resolved;
    }

    const decodedPath = decodeURIComponent(url.pathname);

    const file = Bun.file(`${dataDir}${decodedPath}`);
    if (file.size > 0) {
      return new Response(file);
    }

    return new Response('Not Found', { status: 404 });
  }

  return { routeApiRequest, routeRequest, reloadAssetIndex };
}
