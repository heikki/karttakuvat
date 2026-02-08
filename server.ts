import { serve, spawn } from 'bun';

import indexHtml from './src/index.html';

interface LocationEdit {
  uuid: string;
  lat: number;
  lon: number;
}

interface SetLocationsBody {
  edits: LocationEdit[];
}

async function handleSetLocations(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as SetLocationsBody;
    if (!Array.isArray(body.edits) || body.edits.length === 0) {
      return new Response('No edits provided', { status: 400 });
    }

    const proc = spawn({
      cmd: ['python3', 'scripts/set_locations.py'],
      stdin: new Blob([JSON.stringify(body.edits)]),
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (stderr !== '') {
      console.error('set_locations.py stderr:', stderr);
    }
    if (stdout !== '') {
      console.log('set_locations.py stdout:', stdout);
    }

    if (exitCode !== 0) {
      return new Response(`Script failed: ${stderr}`, { status: 500 });
    }

    // Update items.json in-place with new coordinates
    const itemsFile = Bun.file('public/items.json');
    const items = (await itemsFile.json()) as Array<{
      uuid: string;
      lat: number | null;
      lon: number | null;
      gps: string | null;
    }>;

    for (const edit of body.edits) {
      const item = items.find((i) => i.uuid === edit.uuid);
      if (item !== undefined) {
        item.lat = edit.lat;
        item.lon = edit.lon;
        item.gps = 'user';
      }
    }

    await Bun.write('public/items.json', JSON.stringify(items, null, 2));

    return Response.json({ ok: true, result: stdout.trim() });
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
