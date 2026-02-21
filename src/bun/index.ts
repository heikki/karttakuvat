import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { AppRPC } from '../rpc-types';

const { BrowserView, BrowserWindow, ApplicationMenu, Utils } =
  await import('electrobun/bun');

const { createApiHandler, flushLogBuffer } = await import('../../api-routes');
const { createImageCache } = await import('../../scripts/image-cache');
const { openPhotosDb, countAssets } = await import('../../scripts/photos-db');

// Detect dev build from version.json
const resourcesDir = resolve(dirname(process.argv0), '..', 'Resources');
let isDev = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Bun.file().json() returns any
  const versionInfo: { channel?: string } = await Bun.file(
    join(resourcesDir, 'version.json')
  ).json();
  isDev = versionInfo.channel === 'dev';
} catch {
  // ignore
}

// Find the project root (where scripts/ and public/ live)
function findProjectRoot(): string | null {
  if (isDev) {
    const root = resolve(resourcesDir, '..', '..', '..', '..', '..');
    if (existsSync(join(root, 'scripts'))) return root;
  }
  return null;
}

const projectRoot = findProjectRoot();

// Data directory: in dev builds, use public/ next to the project root
function findDataDir(): string {
  if (
    process.env.KARTTAKUVAT_DATA_DIR !== undefined &&
    process.env.KARTTAKUVAT_DATA_DIR !== ''
  ) {
    return resolve(process.env.KARTTAKUVAT_DATA_DIR);
  }

  if (projectRoot !== null) {
    const publicDir = join(projectRoot, 'public');
    if (existsSync(publicDir)) {
      return publicDir;
    }
  }

  return join(process.env.HOME!, 'Library/Application Support/Karttakuvat');
}

const dataDir = findDataDir();
console.log(`[main] Data directory: ${dataDir}`);

const imageCache = createImageCache({ cacheDir: join(dataDir, 'cache') });
const { routeApiRequest } = createApiHandler(dataDir, { imageCache });

// Locate bundled view files
const appDir = join(resourcesDir, 'app');
const viewsDir = join(appDir, 'views', 'app');

// Detect new photos in library vs exported
function countNewPhotos(): number | null {
  try {
    const itemsFile = join(dataDir, 'items.json');
    if (!existsSync(itemsFile)) return null;
    const items = JSON.parse(readFileSync(itemsFile, 'utf8')) as unknown[];
    const db = openPhotosDb();
    const { photos, videos } = countAssets(db);
    db.close();
    const libraryTotal = photos + videos;
    const exportedTotal = items.length;
    const diff = libraryTotal - exportedTotal;
    if (diff > 0) {
      console.log(
        `[main] ${diff} new photos detected (library: ${libraryTotal}, exported: ${exportedTotal})`
      );
      return diff;
    }
    return null;
  } catch (err) {
    console.log(`[main] Could not check for new photos: ${String(err)}`);
    return null;
  }
}

// Script directory: dev builds use project root, installed builds use bundled scripts
const scriptsDir =
  projectRoot === null ? join(appDir, 'scripts') : join(projectRoot, 'scripts');

// App menu
function buildMenu() {
  const nc = countNewPhotos();
  const exportLabel =
    nc === null ? 'Export Photos' : `Export Photos (${nc} new)`;
  const photosMenuItems = [
    {
      label: 'Photos',
      submenu: [
        { label: exportLabel, action: 'export' },
        { label: 'Export Photos (Full)', action: 'export-full' },
        { label: 'Refresh Edited', action: 'export-edited' },
        { type: 'divider' },
        { label: 'Sync Metadata', action: 'sync' }
      ]
    }
  ];

  ApplicationMenu.setApplicationMenu([
    {
      label: 'Karttakuvat',
      submenu: [
        { label: 'About Karttakuvat', action: 'about' },
        { type: 'divider' },
        {
          label: 'Quit Karttakuvat',
          action: 'quit',
          accelerator: 'CmdOrCtrl+Q'
        }
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
    ...photosMenuItems,
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', accelerator: 'CmdOrCtrl+M' },
        { role: 'close', accelerator: 'CmdOrCtrl+W' }
      ]
    }
  ]);
}

function refreshPhotosMenu() {
  buildMenu();
}

buildMenu();

// Full Disk Access dialog — shown once per session when Photos.sqlite can't be read
let fullDiskAccessShown = false;
function showFullDiskAccessDialog() {
  if (fullDiskAccessShown) return;
  fullDiskAccessShown = true;
  void Utils.showMessageBox({
    type: 'warning',
    title: 'Full Disk Access Required',
    message:
      'Karttakuvat needs Full Disk Access to read photo metadata from Photos.sqlite.',
    detail:
      'Open System Settings > Privacy & Security > Full Disk Access, then enable access for Karttakuvat.\n\nRestart the app after granting access.',
    buttons: ['Open System Settings', 'OK']
  }).then(({ response }: { response: number }) => {
    if (response === 0) {
      Bun.spawn([
        'open',
        'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
      ]);
    }
  });
}

async function checkFullDiskAccess(response: Response, pathname: string) {
  if (response.status === 500 && pathname.startsWith('/api/metadata/')) {
    const body = await response.clone().text();
    if (
      body.includes('CANTOPEN') ||
      body.includes('unable to open') ||
      body.includes('not found')
    ) {
      showFullDiskAccessDialog();
    }
  }
}

function serveStaticFile(decodedPath: string): Response | null {
  if (decodedPath === '/' || decodedPath === '/index.html') {
    return new Response(Bun.file(join(viewsDir, 'index.html')));
  }

  const viewFile = Bun.file(join(viewsDir, decodedPath));
  if (viewFile.size > 0) return new Response(viewFile);

  const dataFile = Bun.file(join(dataDir, decodedPath));
  if (dataFile.size > 0) return new Response(dataFile);

  return null;
}

// Start local server that serves both API and view files
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);

    // API routes
    const apiResponse = routeApiRequest(req, url.pathname);
    if (apiResponse !== null) {
      const response = await apiResponse;
      if (response !== null) {
        for (const line of flushLogBuffer()) {
          console.log(line);
        }
        await checkFullDiskAccess(response, url.pathname);
        return response;
      }
    }

    // Serve bundled view files, then static data files
    const decodedPath = decodeURIComponent(url.pathname);
    return (
      serveStaticFile(decodedPath) ?? new Response('Not Found', { status: 404 })
    );
  }
});

const baseUrl = `http://127.0.0.1:${server.port}`;
console.log(`[main] Server running on ${baseUrl}`);

// Window state persistence
const configDir = join(
  process.env.HOME!,
  'Library/Application Support/Karttakuvat'
);
const stateFile = join(configDir, 'window-state.json');
const defaultFrame = { x: 100, y: 100, width: 1200, height: 800 };

function loadWindowState(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  } catch {
    return defaultFrame;
  }
}

function saveWindowState(frame: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(frame));
}

// Create browser window
const rpc = BrowserView.defineRPC<AppRPC>({
  handlers: {
    requests: {},
    messages: {}
  }
});

const savedFrame = loadWindowState();

const win = new BrowserWindow<typeof rpc>({
  title: 'Karttakuvat',
  url: baseUrl,
  frame: savedFrame,
  rpc
});

// Save window state on move/resize
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSave() {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const frame = win.getFrame();
    saveWindowState(frame);
  }, 500);
}

win.on('move', debouncedSave);
win.on('resize', debouncedSave);

// Open external links (target="_blank", window.open) in system browser
function openInSystem(url: string) {
  if (url !== '' && !url.startsWith(baseUrl)) {
    console.log(`[main] Opening external: ${url}`);
    Bun.spawn(['open', url]);
  }
}

interface ElectrobunEvent {
  data?: { detail?: string | { url?: string }; action?: string };
}

function extractUrl(event: ElectrobunEvent): string {
  const detail = event.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail !== undefined && typeof detail.url === 'string') return detail.url;
  return '';
}

win.webview.on('will-navigate', (event: ElectrobunEvent) => {
  const url = extractUrl(event);
  if (url !== '' && !url.startsWith(baseUrl)) {
    openInSystem(url);
  }
});
// @ts-expect-error -- new-window-open not in BrowserView.on() types
win.webview.on('new-window-open', (event: ElectrobunEvent) => {
  openInSystem(extractUrl(event));
});

// Run a script from the scripts/ directory, show progress in window title
let runningScript: { proc: ReturnType<typeof Bun.spawn>; name: string } | null =
  null;

// eslint-disable-next-line no-control-regex -- stripping ANSI escape codes
const ansiPattern = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Stream stdout from a child process, updating window title with progress. */
async function streamStdout(
  stdout: ReadableStream<Uint8Array>,
  name: string,
  outputLines: string[]
) {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let partial = '';
  let done = false;

  while (!done) {
    // eslint-disable-next-line no-await-in-loop -- sequential stream reads
    const result = await reader.read();
    done = result.done;
    if (done) break;
    const text = partial + decoder.decode(result.value, { stream: true });
    const parts = text.split(/[\r\n]/);
    partial = parts.pop() ?? '';
    for (const line of parts) {
      const trimmed = line.replace(ansiPattern, '').trim();
      if (trimmed !== '') {
        outputLines.push(trimmed);
        console.log(`[${name}] ${trimmed}`);
        win.setTitle(`Karttakuvat — ${trimmed}`);
      }
    }
  }
  if (partial.trim() !== '') {
    outputLines.push(partial.trim());
  }
}

function resolveScriptPath(scriptFile: string): string | null {
  const ext = projectRoot === null ? '.js' : '.ts';
  const scriptPath = join(scriptsDir, scriptFile.replace(/\.ts$/, ext));
  if (existsSync(scriptPath)) return scriptPath;
  return null;
}

async function runScript(
  name: string,
  scriptFile: string,
  args: string[] = []
) {
  if (runningScript !== null) {
    void Utils.showMessageBox({
      type: 'warning',
      title: 'Script Running',
      message: `"${runningScript.name}" is still running. Please wait for it to finish.`,
      buttons: ['OK']
    });
    return;
  }

  const scriptPath = resolveScriptPath(scriptFile);
  if (scriptPath === null) {
    void Utils.showMessageBox({
      type: 'error',
      title: 'Script Not Found',
      message: `Could not find ${scriptFile}`,
      buttons: ['OK']
    });
    return;
  }

  // Installed builds pass --data-dir so scripts know where to write
  const extraArgs = projectRoot === null ? [`--data-dir=${dataDir}`] : [];

  console.log(
    `[main] Running ${name}: bun ${scriptFile} ${[...args, ...extraArgs].join(' ')}`
  );
  win.setTitle(`Karttakuvat — ${name}...`);

  // Dev: use system bun (needs node_modules). Installed: use bundled bun.
  const bunPath =
    projectRoot === null
      ? resolve(dirname(process.argv0), 'bun')
      : (Bun.which('bun') ?? 'bun');
  const proc = Bun.spawn([bunPath, scriptPath, ...args, ...extraArgs], {
    cwd: projectRoot ?? dataDir,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  runningScript = { proc, name };

  const outputLines: string[] = [];
  void streamStdout(
    proc.stdout as ReadableStream<Uint8Array>,
    name,
    outputLines
  );

  // Capture stderr
  const stderrText = await new Response(proc.stderr).text();
  if (stderrText.trim() !== '') {
    console.log(`[${name} stderr] ${stderrText.trim()}`);
    outputLines.push(stderrText.trim());
  }

  const exitCode = await proc.exited;
  runningScript = null; // eslint-disable-line require-atomic-updates -- intentional sequential reset
  win.setTitle('Karttakuvat');

  const lastLines = outputLines.slice(-8).join('\n');
  if (exitCode === 0) {
    refreshPhotosMenu();
    win.webview.loadURL(baseUrl);
    void Utils.showMessageBox({
      type: 'info',
      title: `${name} Complete`,
      message: `${name} finished successfully.`,
      detail: lastLines,
      buttons: ['OK']
    });
  } else {
    void Utils.showMessageBox({
      type: 'error',
      title: `${name} Failed`,
      message: `${name} exited with code ${exitCode}.`,
      detail: lastLines,
      buttons: ['OK']
    });
  }
}

// Handle menu actions
ApplicationMenu.on('application-menu-clicked', (event: ElectrobunEvent) => {
  const action = event.data?.action ?? '';
  switch (action) {
    case 'quit':
      process.exit(0);
      break;
    case 'export':
      void runScript('Export', 'export.ts');
      break;
    case 'export-full':
      void runScript('Full Export', 'export.ts', ['--full']);
      break;
    case 'export-edited':
      void runScript('Refresh Edited', 'export.ts', ['--refresh-edited']);
      break;
    case 'sync':
      void runScript('Sync Metadata', 'sync.ts');
      break;
  }
});

// Auto-sync on first launch (when items.json doesn't exist yet)
if (!existsSync(join(dataDir, 'items.json'))) {
  console.log('[main] No items.json found — running initial sync');
  void runScript('Initial Sync', 'sync.ts');
}

console.log('[main] Initialization complete');
