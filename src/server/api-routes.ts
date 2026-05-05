import { deleteAlbumFile, getAlbumFiles, setFileVisible } from './album-files';
import type { ImageCache } from './image-cache';
import type { ItemStore, LocationEdit, TimeEdit } from './item-store';
import {
  openPhotosDb,
  queryAssetIndex,
  queryMetadata,
  type AssetRecord
} from './photos-db';
import { handleRouteProxy } from './route-proxy';
import { setSetting } from './state';
import { defaultLibraryPath, serveVideo } from './video-stream';

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
  imageCache?: ImageCache;
  libraryPath?: string;
}

/**
 * Create API route handler parameterized by data directory.
 * The dataDir should contain `items.json`, `state.json`, `cache/`, `albums/`.
 */
export function createApiHandler(dataDir: string, options: ApiHandlerOptions) {
  const { itemStore, imageCache } = options;
  const libraryPath = options.libraryPath ?? defaultLibraryPath();
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
      const record = queryMetadata(getPhotosDb(), uuid);
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
      return handleRouteProxy(req, dataDir);
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
          libraryPath,
          getAssetIndex().get(videoMatch.groups.id!),
          req
        );
      }
    }

    return null;
  }

  return { routeApiRequest };
}
