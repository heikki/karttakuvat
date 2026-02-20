import { serve, spawn } from 'bun';

import indexHtml from './src/index.html';

interface LocationEdit {
  uuid: string;
  lat: number;
  lon: number;
}

interface TimeEdit {
  uuid: string;
  hours: number;
}

interface SetLocationsBody {
  edits: LocationEdit[];
  timeEdits?: TimeEdit[];
}

const datePattern =
  /^(?<yr>\d{4}):(?<mo>\d{2}):(?<dy>\d{2}) (?<hr>\d{2}):(?<mi>\d{2}):(?<sc>\d{2})$/v;

function dateToUtc(dateStr: string, tz: string | null): string {
  if (dateStr === '' || tz === null || tz === '') return dateStr;
  const sign = tz.startsWith('+') ? 1 : -1;
  const h = parseInt(tz.slice(1, 3), 10);
  const m = parseInt(tz.slice(4, 6), 10);
  const offsetHours = sign * (h + m / 60);
  return applyHourOffset(dateStr, -offsetHours);
}

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
let requestLabel = '';

function bufferScriptOutput(
  label: string,
  stdout: string,
  stderr: string
): void {
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  if (stderr !== '') {
    scriptLogBuffer.push(
      `    ${label} \x1b[31m${stderr.trim()}${reset}`
    );
  }
  if (stdout === '') return;
  try {
    const parsed: unknown = JSON.parse(stdout);
    const results: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const r of results) {
      const rec = r as Record<string, unknown>;
      const id = typeof rec.uuid === 'string' ? rec.uuid : '?';
      if (rec.ok === true) {
        scriptLogBuffer.push(`    ${label} ${dim}${id}${reset}`);
      } else {
        const error = typeof rec.error === 'string' ? rec.error : 'failed';
        scriptLogBuffer.push(
          `    ${label} \x1b[31m✗${reset} ${dim}${id}${reset}\n         ${dim}${error}${reset}`
        );
      }
    }
  } catch {
    scriptLogBuffer.push(`    ${label} ${dim}${stdout.trim()}${reset}`);
  }
}

async function runScript(
  cmd: string[],
  input: string,
  label: string,
  { quiet = false } = {}
): Promise<{ error: Response } | { stdout: string }> {
  const proc = spawn({
    cmd,
    stdin: new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (!quiet) {
    bufferScriptOutput(label, stdout, stderr);
  }

  if (exitCode !== 0) {
    return {
      error: new Response(`${label} failed: ${stderr}`, { status: 500 })
    };
  }
  return { stdout };
}

interface ItemRecord {
  uuid: string;
  date: string;
  tz: string | null;
  lat: number | null;
  lon: number | null;
  gps: string | null;
  gps_accuracy: number | null;
}

interface ScriptResult {
  uuid: string;
  ok: boolean;
  tz?: string | null;
  error?: string;
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
      const tz = tzResults.get(edit.uuid);
      if (tz !== undefined) {
        item.tz = tz;
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

async function processLocationEdits(
  edits: LocationEdit[],
  itemsByUuid: Map<string, ItemRecord>
): Promise<{ error?: Response; tzResults: Map<string, string | null> }> {
  const tzResults = new Map<string, string | null>();
  if (edits.length === 0) return { tzResults };

  const editsWithDates = edits.map((e) => {
    const item = itemsByUuid.get(e.uuid);
    return { ...e, date: item?.date ?? '', tz: item?.tz ?? null };
  });

  const result = await runScript(
    ['python3', 'scripts/set_locations.py'],
    JSON.stringify(editsWithDates),
    '📍'
  );
  if ('error' in result) return { error: result.error, tzResults };

  try {
    const scriptResults = JSON.parse(result.stdout) as ScriptResult[];
    for (const r of scriptResults) {
      if (r.ok && r.tz !== undefined) {
        tzResults.set(r.uuid, r.tz);
      }
    }
  } catch {
    // tz update in items.json will be skipped
  }
  return { tzResults };
}

async function processTimeEdits(
  edits: TimeEdit[],
  itemsByUuid: Map<string, ItemRecord>
): Promise<Response | null> {
  if (edits.length === 0) return null;

  const timeEditsWithTarget = edits
    .map((edit) => {
      const item = itemsByUuid.get(edit.uuid);
      if (item === undefined) return undefined;
      const target = applyHourOffset(item.date, edit.hours);
      const [datePart, timePart] = target.split(' ');
      if (datePart === undefined || timePart === undefined) {
        return undefined;
      }
      return {
        uuid: edit.uuid,
        date: datePart.replaceAll(':', '-'),
        time: timePart
      };
    })
    .filter((e) => e !== undefined);

  const result = await runScript(
    ['python3', 'scripts/set_times.py'],
    JSON.stringify(timeEditsWithTarget),
    '🕐'
  );
  if ('error' in result) return result.error;
  return null;
}

async function handleGetGpxFiles(album: string): Promise<Response> {
  try {
    const { readdir } = await import('node:fs/promises');
    const dir = `public/albums/${album}`;
    const entries = await readdir(dir).catch(() => [] as string[]);
    const gpxFiles = entries.filter((f) => f.toLowerCase().endsWith('.gpx'));
    return Response.json(gpxFiles);
  } catch {
    return Response.json([]);
  }
}

async function handleGetMetadata(uuid: string): Promise<Response> {
  try {
    const result = await runScript(
      [
        `${process.env.HOME}/.local/bin/osxphotos`,
        'query',
        '--uuid',
        uuid,
        '--json'
      ],
      '',
      'osxphotos query',
      { quiet: true }
    );
    if ('error' in result) return result.error;

    const photos = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    if (photos.length === 0) {
      return new Response('Not found', { status: 404 });
    }

    return Response.json(photos[0]);
  } catch (err) {
    return new Response(`Error: ${String(err)}`, { status: 500 });
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

    const parts: string[] = [];
    if (locationEdits.length > 0) {
      parts.push(`${locationEdits.length} location`);
    }
    if (timeEdits.length > 0) parts.push(`${timeEdits.length} time`);
    requestLabel = parts.join(', ');

    // Load items to get dates for timezone lookup
    const itemsFile = Bun.file('public/items.json');
    const items = (await itemsFile.json()) as ItemRecord[];
    const itemsByUuid = new Map(items.map((i) => [i.uuid, i]));

    const locResult = await processLocationEdits(locationEdits, itemsByUuid);
    if (locResult.error !== undefined) return locResult.error;

    const timeError = await processTimeEdits(timeEdits, itemsByUuid);
    if (timeError !== null) return timeError;

    applyLocationEdits(items, locationEdits, locResult.tzResults);
    applyTimeEdits(items, timeEdits);
    items.sort((a, b) => {
      const d = dateToUtc(a.date, a.tz).localeCompare(dateToUtc(b.date, b.tz));
      return d === 0 ? a.uuid.localeCompare(b.uuid) : d;
    });

    await Bun.write('public/items.json', JSON.stringify(items, null, 2));

    const prettier = await import('prettier');
    const raw = await Bun.file('public/items.json').text();
    const formatted = await prettier.format(raw, { parser: 'json' });
    await Bun.write('public/items.json', formatted);

    return Response.json({ ok: true });
  } catch (err) {
    console.error('handleSaveEdits error:', err);
    return new Response(`Server error: ${String(err)}`, { status: 500 });
  }
}

function routeApiRequest(
  req: Request,
  pathname: string
): Promise<Response> | null {
  if (pathname === '/api/save-edits' && req.method === 'POST') {
    return handleSaveEdits(req);
  }

  const gpxMatch = /^\/api\/gpx\/(?<album>.+)$/.exec(pathname);
  if (gpxMatch?.groups !== undefined && req.method === 'GET') {
    return handleGetGpxFiles(decodeURIComponent(gpxMatch.groups.album!));
  }

  const metadataMatch = /^\/api\/metadata\/(?<id>[A-F0-9-]+)$/i.exec(pathname);
  if (metadataMatch?.groups !== undefined && req.method === 'GET') {
    return handleGetMetadata(metadataMatch.groups.id!);
  }

  return null;
}

async function routeRequest(req: Request, url: URL): Promise<Response> {
  const apiResponse = routeApiRequest(req, url.pathname);
  if (apiResponse !== null) return await apiResponse;

  const decodedPath = decodeURIComponent(url.pathname);

  // Check public directory first
  let file = Bun.file(`public${decodedPath}`);
  if (file.size > 0) {
    return new Response(file);
  }

  // Check src directory (for CSS, etc.)
  file = Bun.file(`src${decodedPath}`);
  if (file.size > 0) {
    return new Response(file);
  }

  return new Response('Not Found', { status: 404 });
}

function logRequest(
  method: string,
  pathname: string,
  status: number,
  ms: number
) {
  const methodColors: Record<string, string> = {
    GET: '\x1b[36m', // cyan
    POST: '\x1b[33m', // yellow
    PUT: '\x1b[35m', // magenta
    DELETE: '\x1b[31m' // red
  };
  const reset = '\x1b[0m';
  const dim = '\x1b[2m';
  const methodColor = methodColors[method] ?? '\x1b[37m';

  const statusColor =
    status < 300
      ? '\x1b[32m' // green
      : status < 400
        ? '\x1b[33m' // yellow
        : '\x1b[31m'; // red

  const pathDisplay = pathname;
  const timing = `${dim}${ms.toFixed(0)}ms${reset}`;

  const labelDisplay =
    requestLabel === '' ? '' : ` ${dim}(${requestLabel})${reset}`;
  requestLabel = '';

  console.log(
    `  ${methodColor}${method.padEnd(4)}${reset} ${pathDisplay}${labelDisplay} ${statusColor}${status}${reset} ${timing}`
  );
}

const server = serve({
  routes: {
    '/': indexHtml
  },
  development: true,
  async fetch(req) {
    const start = performance.now();
    const url = new URL(req.url);
    const response = await routeRequest(req, url);

    const isImage = /\.(?:jpe?g|png|gif|webp|avif|svg|ico)$/i.test(
      url.pathname
    );
    if (!isImage || response.status >= 400) {
      logRequest(
        req.method,
        url.pathname,
        response.status,
        performance.now() - start
      );
    }
    for (const line of scriptLogBuffer) {
      console.log(line);
    }
    scriptLogBuffer.length = 0;
    return response;
  }
});

console.log(`🚀 Server running on ${server.url.toString()}`);
