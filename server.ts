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

async function runScript(
  cmd: string[],
  input: string,
  label: string
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

  if (stderr !== '') {
    console.error(`${label} stderr:`, stderr);
  }
  if (stdout !== '') {
    console.log(`${label} stdout:`, stdout);
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

  const editsWithDates = edits.map((e) => ({
    ...e,
    date: itemsByUuid.get(e.uuid)?.date ?? ''
  }));

  const result = await runScript(
    ['python3', 'scripts/set_locations.py'],
    JSON.stringify(editsWithDates),
    'set_locations.py'
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
    'set_times.py'
  );
  if ('error' in result) return result.error;
  return null;
}

async function handleSetLocations(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as SetLocationsBody;
    const locationEdits = Array.isArray(body.edits) ? body.edits : [];
    const timeEdits = Array.isArray(body.timeEdits) ? body.timeEdits : [];

    if (locationEdits.length === 0 && timeEdits.length === 0) {
      return new Response('No edits provided', { status: 400 });
    }

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
      const d = a.date.localeCompare(b.date);
      return d === 0 ? a.uuid.localeCompare(b.uuid) : d;
    });

    await Bun.write('public/items.json', JSON.stringify(items, null, 2));

    return Response.json({ ok: true });
  } catch (err) {
    console.error('handleSetLocations error:', err);
    return new Response(`Server error: ${String(err)}`, { status: 500 });
  }
}

const server = serve({
  routes: {
    '/': indexHtml
  },
  development: true,
  async fetch(req) {
    const url = new URL(req.url);

    // API routes
    if (url.pathname === '/api/set-locations' && req.method === 'POST') {
      return await handleSetLocations(req);
    }

    // Check public directory first
    let file = Bun.file(`public${url.pathname}`);
    if (file.size > 0) return new Response(file);

    // Check src directory (for CSS, etc.)
    file = Bun.file(`src${url.pathname}`);
    if (file.size > 0) return new Response(file);

    return new Response('Not Found', { status: 404 });
  }
});

console.log(`🚀 Server running on ${server.url.toString()}`);
