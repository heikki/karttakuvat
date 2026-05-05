import { deleteAlbumFile, getAlbumFiles, setFileVisible } from './album-files';
import type { ImageCache } from './image-cache';
import type { ItemStore, LocationEdit, TimeEdit } from './item-store';
import type { PhotosLibrary } from './photos-db';
import { getSetting, setSetting } from './state';
import { serveVideo } from './video-stream';

// Map client profile names to OpenRouteService profile names
const ORS_PROFILES: Record<string, string> = {
  driving: 'driving-car',
  walking: 'foot-walking',
  hiking: 'foot-hiking',
  cycling: 'cycling-regular'
};

function serverError(context: string, err: unknown): Response {
  console.error(`${context} error:`, err);
  return new Response('Internal server error', { status: 500 });
}

interface SetLocationsBody {
  edits: LocationEdit[];
  timeEdits?: TimeEdit[];
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
  return scriptLogBuffer.splice(0);
}

interface ApiHandlerOptions {
  itemStore: ItemStore;
  photosLibrary: PhotosLibrary;
  imageCache?: ImageCache;
}

/**
 * Create API route handler parameterized by data directory.
 * The dataDir should contain `items.json`, `state.json`, `cache/`, `albums/`.
 */
export function createApiHandler(dataDir: string, options: ApiHandlerOptions) {
  const { itemStore, imageCache, photosLibrary } = options;

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
      return serverError('handleUploadAlbumFile', err);
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
      const dbInfo = getAlbumFiles(dataDir, album);
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
      deleteAlbumFile(dataDir, album, filename);
      return Response.json({ ok: true });
    } catch (err) {
      return serverError('handleDeleteAlbumFile', err);
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
        setFileVisible(dataDir, album, filename, visible);
        return Response.json({ ok: true });
      })
      .catch((err: unknown) => serverError('handleSetFileVisibility', err));
  }

  function handleGetMetadata(uuid: string): Response {
    try {
      const record = photosLibrary.getMetadata(uuid);
      if (record === null) {
        return new Response('Not found', { status: 404 });
      }
      return Response.json(record);
    } catch (err) {
      return serverError('handleGetMetadata', err);
    }
  }

  async function handleSaveEdits(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as SetLocationsBody;
      const locationEdits = Array.isArray(body.edits) ? body.edits : [];
      const timeEdits = Array.isArray(body.timeEdits) ? body.timeEdits : [];

      if (locationEdits.length === 0 && timeEdits.length === 0) {
        return new Response('No edits provided', { status: 400 });
      }

      const results = itemStore.applyEdits({ locationEdits, timeEdits });
      for (const r of results.locationResults) {
        logEditResult('📍', r.uuid, r.ok ? undefined : r.error);
      }
      for (const r of results.timeResults) {
        logEditResult('⏰', r.uuid, r.ok ? undefined : r.error);
      }

      return Response.json({ ok: true });
    } catch (err) {
      return serverError('handleSaveEdits', err);
    }
  }

  /** Serve an image via on-demand conversion + cache. */
  function handleImageRequest(
    uuid: string,
    size: 'full' | 'thumb'
  ): Response | null {
    if (imageCache === undefined) return null;

    const asset = photosLibrary.getAsset(uuid);
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

  async function handleGetRoute(album: string): Promise<Response> {
    try {
      const { readFile } = await import('node:fs/promises');
      const filePath = `${dataDir}/albums/${album}/_route.json`;
      const content = await readFile(filePath, 'utf-8');
      return new Response(content, {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }

  async function handlePutRoute(
    album: string,
    req: Request
  ): Promise<Response> {
    try {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const dir = `${dataDir}/albums/${album}`;
      await mkdir(dir, { recursive: true });
      const body = await req.text();
      await writeFile(`${dir}/_route.json`, body, 'utf-8');
      return Response.json({ ok: true });
    } catch (err) {
      return serverError('handlePutRoute', err);
    }
  }

  async function handleDeleteRoute(album: string): Promise<Response> {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(`${dataDir}/albums/${album}/_route.json`);
      return Response.json({ ok: true });
    } catch {
      return Response.json({ ok: true });
    }
  }

  async function fetchOrsRoute(
    apiKey: string,
    coordinates: Array<[number, number]>,
    orsProfile: string
  ): Promise<Response> {
    const url = `https://api.openrouteservice.org/v2/directions/${orsProfile}/geojson`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({ coordinates })
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[route] ORS ${resp.status}: ${text}`);
      return new Response(`Routing error: ${resp.status}`, {
        status: resp.status
      });
    }
    const data = (await resp.json()) as {
      features?: Array<{ geometry: unknown }>;
    };
    const feature = data.features?.[0];
    if (feature === undefined) {
      return new Response('No route found', { status: 404 });
    }
    return Response.json({ geometry: feature.geometry });
  }

  async function handleRouteProxy(req: Request): Promise<Response> {
    const apiKey =
      process.env.PUBLIC_ORS_API_KEY ??
      process.env.ORS_API_KEY ??
      getSetting(dataDir, 'ors_api_key');
    if (apiKey === null || apiKey === '') {
      return new Response(
        'ORS_API_KEY not configured. Set env var or db setting "ors_api_key".',
        { status: 503 }
      );
    }
    try {
      const body = (await req.json()) as {
        coordinates: Array<[number, number]>;
        profile: string;
      };
      const orsProfile = ORS_PROFILES[body.profile];
      if (orsProfile === undefined || body.coordinates.length < 2) {
        return new Response('Invalid request', { status: 400 });
      }
      return await fetchOrsRoute(apiKey, body.coordinates, orsProfile);
    } catch (err) {
      console.error('handleRouteProxy error:', err);
      return new Response('Internal server error', { status: 500 });
    }
  }

  /** Route an API request. Returns null if the path doesn't match any API route. */
  // eslint-disable-next-line complexity -- routing dispatch with multiple patterns
  function routeApiRequest(
    req: Request,
    pathname: string
  ): Promise<Response | null> | Response | null {
    if (pathname === '/api/items' && req.method === 'GET') {
      return Response.json(itemStore.getAll());
    }

    if (pathname === '/api/view-state' && req.method === 'PUT') {
      return req
        .json()
        .then((body: unknown) => {
          setSetting(dataDir, 'view', JSON.stringify(body));
          return new Response(null, { status: 204 });
        })
        .catch(() => new Response('Bad request', { status: 400 }));
    }

    if (pathname === '/api/save-edits' && req.method === 'POST') {
      return handleSaveEdits(req);
    }

    if (pathname === '/api/route' && req.method === 'POST') {
      return handleRouteProxy(req);
    }

    const routeMatch = /^\/api\/albums\/(?<album>[^/]+)\/route$/.exec(pathname);
    if (routeMatch?.groups !== undefined) {
      const album = decodeURIComponent(routeMatch.groups.album!);
      if (req.method === 'GET') return handleGetRoute(album);
      if (req.method === 'PUT') return handlePutRoute(album, req);
      if (req.method === 'DELETE') return handleDeleteRoute(album);
    }

    const uploadMatch = /^\/api\/albums\/(?<album>.+)\/upload$/.exec(pathname);
    if (uploadMatch?.groups !== undefined && req.method === 'POST') {
      return handleUploadAlbumFile(
        req,
        decodeURIComponent(uploadMatch.groups.album!)
      );
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

    // Direct video streaming from the Photos library (range-aware)
    if (req.method === 'GET') {
      const videoMatch = /^\/video\/(?<id>[A-F0-9-]+)$/i.exec(pathname);
      if (videoMatch?.groups !== undefined) {
        return serveVideo(
          photosLibrary.libraryPath,
          photosLibrary.getAsset(videoMatch.groups.id!),
          req
        );
      }
    }

    return null;
  }

  return { routeApiRequest };
}
