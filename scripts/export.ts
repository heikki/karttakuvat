#!/usr/bin/env bun
/**
 * Export photos and videos from Apple Photos library.
 *
 * Replaces export.py — uses photos-db.ts for metadata and macOS tools
 * (sips, qlmanage) for file operations.
 *
 * Usage:
 *   bun scripts/export.ts                    # Incremental update
 *   bun scripts/export.ts --full             # Full re-export
 *   bun scripts/export.ts --refresh-edited   # Re-export edited photos
 *   bun scripts/export.ts --verify           # Check files match items.json
 *   bun scripts/export.ts --album "Name"     # Single album
 *
 * Requirements:
 *   - Full Disk Access for Terminal in System Settings
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync
} from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';

import {
  resolveEditedPath,
  resolveOriginalPath
} from './image-cache';
import {
  buildItemEntry,
  sortEntries,
  writeItemsJson,
  type ItemEntry
} from './items';
import {
  openPhotosDb,
  queryEdited,
  queryPhotos,
  queryVideos,
  type PhotoRecord
} from './photos-db';

// ---------- Progress display ----------

class Progress {
  private readonly total: number;
  private readonly label: string;
  private readonly start: number;

  constructor(total: number, label = '') {
    this.total = total;
    this.label = label;
    this.start = performance.now();
    this.print(0);
  }

  update(current: number): void {
    this.print(current);
  }

  done(suffix = ''): void {
    const elapsed = (performance.now() - this.start) / 1000;
    let msg = `\r  ${this.label}${this.total}/${this.total} done in ${Progress.fmt(elapsed)}`;
    if (suffix !== '') msg += ` (${suffix})`;
    process.stdout.write(`${msg}\x1b[K\n`);
  }

  private print(current: number): void {
    const elapsed = (performance.now() - this.start) / 1000;
    const pct = this.total > 0 ? (current / this.total) * 100 : 0;
    const parts = [
      `\r  ${this.label}${current}/${this.total} (${pct.toFixed(0)}%)`
    ];
    if (current > 0 && elapsed > 1) {
      const rate = current / elapsed;
      const remaining = (this.total - current) / rate;
      parts.push(
        ` — ${Progress.fmt(elapsed)} elapsed, ~${Progress.fmt(remaining)} left`
      );
    }
    process.stdout.write(`${parts.join('')}\x1b[K`);
  }

  private static fmt(secs: number): string {
    if (secs < 60) return `${secs.toFixed(0)}s`;
    return `${Math.floor(secs / 60)}m${String(Math.floor(secs) % 60).padStart(2, '0')}s`;
  }
}

// ---------- File path helpers ----------

const PROJECT_ROOT = join(import.meta.dir, '..');
const dataDirArg = process.argv.find((a) => a.startsWith('--data-dir='));
const PUBLIC_DIR = dataDirArg ? dataDirArg.split('=')[1]! : join(PROJECT_ROOT, 'public');
const FULL_DIR = join(PUBLIC_DIR, 'full');
const THUMB_DIR = join(PUBLIC_DIR, 'thumb');
const JSON_PATH = join(PUBLIC_DIR, 'items.json');

function defaultLibraryPath(): string {
  return join(homedir(), 'Pictures/Photos Library.photoslibrary');
}

// Wrap shared resolvers for PhotoRecord interface
function resolveOriginal(
  libraryPath: string,
  record: PhotoRecord
): string | null {
  return resolveOriginalPath(libraryPath, record.directory, record.filename);
}

function resolveEdited(
  libraryPath: string,
  record: PhotoRecord
): string | null {
  return resolveEditedPath(libraryPath, record.directory, record.filename);
}

// ---------- Shell helpers ----------

async function run(cmd: string[]): Promise<boolean> {
  const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
  const code = await proc.exited;
  return code === 0;
}

async function sipsConvert(
  input: string,
  output: string,
  quality = '90'
): Promise<boolean> {
  return await run([
    'sips',
    '-s',
    'format',
    'jpeg',
    '-s',
    'formatOptions',
    quality,
    input,
    '--out',
    output
  ]);
}

async function qlmanageToJpeg(
  inputPath: string,
  outputJpeg: string,
  tmpDir: string
): Promise<boolean> {
  mkdirSync(tmpDir, { recursive: true });
  const ok = await run([
    'qlmanage',
    '-t',
    '-s',
    '1920',
    '-o',
    tmpDir,
    inputPath
  ]);
  if (ok) {
    const files = readdirSync(tmpDir);
    const imgFile = files.find((f) => /\.(?:png|jpe?g)$/i.test(f));
    if (imgFile !== undefined) {
      const imgPath = join(tmpDir, imgFile);
      const ext = extname(imgFile).toLowerCase();
      const isJpeg = ext === '.jpg' || ext === '.jpeg';
      if (isJpeg) copyFileSync(imgPath, outputJpeg);
      const result = isJpeg || (await sipsConvert(imgPath, outputJpeg));
      rmSync(tmpDir, { recursive: true, force: true });
      return result;
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });
  return false;
}

// ---------- Export functions ----------

async function exportPhoto(
  record: PhotoRecord,
  fullDir: string,
  libraryPath: string
): Promise<boolean> {
  const outputPath = join(fullDir, `${record.uuid}.jpg`);
  const originalPath = resolveOriginal(libraryPath, record);
  if (originalPath === null) return false;

  const ext = extname(originalPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    copyFileSync(originalPath, outputPath);
    return true;
  }
  if (ext === '.heic' || ext === '.heif') {
    const tmpPath = join(fullDir, `${record.uuid}.heic`);
    copyFileSync(originalPath, tmpPath);
    const ok = await sipsConvert(tmpPath, outputPath);
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    return ok;
  }
  return await sipsConvert(originalPath, outputPath);
}

async function exportEditedPhoto(
  record: PhotoRecord,
  fullDir: string,
  libraryPath: string
): Promise<boolean> {
  const outputPath = join(fullDir, `${record.uuid}.jpg`);
  const renderedPath = resolveEdited(libraryPath, record);
  if (renderedPath !== null) {
    const ext = extname(renderedPath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') {
      copyFileSync(renderedPath, outputPath);
      return true;
    }
    if (await sipsConvert(renderedPath, outputPath)) return true;
  }

  const originalPath = resolveOriginal(libraryPath, record);
  if (originalPath === null) return false;
  return await qlmanageToJpeg(
    originalPath,
    outputPath,
    join(fullDir, `.ql_tmp_${record.uuid}`)
  );
}

async function exportVideoFrame(
  record: PhotoRecord,
  fullDir: string,
  libraryPath: string
): Promise<boolean> {
  const originalPath = resolveOriginal(libraryPath, record);
  if (originalPath === null) return false;
  return await qlmanageToJpeg(
    originalPath,
    join(fullDir, `${record.uuid}.jpg`),
    join(fullDir, `.ql_tmp_${record.uuid}`)
  );
}

async function createThumbnail(
  fullPath: string,
  thumbPath: string
): Promise<boolean> {
  return await run([
    'sips',
    '-Z',
    '400',
    '-s',
    'format',
    'jpeg',
    '-s',
    'formatOptions',
    '80',
    fullPath,
    '--out',
    thumbPath
  ]);
}

// ---------- Export pipeline ----------

function getExportedUuids(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => f.slice(0, -4))
  );
}

function formatSuffix(
  exported: number,
  icloud: number,
  errors: number
): string {
  return [
    exported > 0 ? `${exported} exported` : '',
    icloud > 0 ? `${icloud} iCloud-only` : '',
    errors > 0 ? `${errors} errors` : ''
  ]
    .filter(Boolean)
    .join(', ');
}

interface ExportBatchOpts {
  records: PhotoRecord[];
  fullDir: string;
  libraryPath: string;
  existingUuids: Set<string>;
  label: string;
  exportFn: (r: PhotoRecord, d: string, l: string) => Promise<boolean>;
}

async function exportBatch(opts: ExportBatchOpts): Promise<void> {
  const { records, fullDir, libraryPath, existingUuids, label, exportFn } =
    opts;
  const toExport = records.filter((r) => !existingUuids.has(r.uuid));
  console.log(
    `${label}: ${records.length} total, ${toExport.length} need exporting`
  );
  if (toExport.length === 0) return;

  const progress = new Progress(toExport.length, `${label}: `);
  let exported = 0;
  let icloud = 0;
  let errors = 0;

  for (let i = 0; i < toExport.length; i++) {
    const record = toExport[i]!;
    // eslint-disable-next-line no-await-in-loop -- sequential file operations
    const ok = await exportFn(record, fullDir, libraryPath);
    if (ok) {
      exported++;
    } else if (resolveOriginal(libraryPath, record) === null) {
      icloud++;
    } else {
      process.stdout.write(`\n  Error: ${record.uuid}`);
      errors++;
    }
    progress.update(i + 1);
  }
  progress.done(formatSuffix(exported, icloud, errors));
}

async function createThumbnails(
  fullDir: string,
  thumbDir: string
): Promise<void> {
  const fullFiles = readdirSync(fullDir).filter((f) => f.endsWith('.jpg'));
  const thumbSet = new Set(
    readdirSync(thumbDir).filter((f) => f.endsWith('.jpg'))
  );
  const toCreate = fullFiles.filter((f) => !thumbSet.has(f));
  console.log(
    `Thumbnails: ${fullFiles.length} images, ${toCreate.length} need creating`
  );
  if (toCreate.length === 0) return;

  const progress = new Progress(toCreate.length, 'Thumbnails: ');
  let errors = 0;
  for (let i = 0; i < toCreate.length; i++) {
    const file = toCreate[i]!;
    // eslint-disable-next-line no-await-in-loop -- sequential sips calls
    const ok = await createThumbnail(join(fullDir, file), join(thumbDir, file));
    if (!ok) {
      process.stdout.write(`\n  Error: ${file}`);
      errors++;
    }
    progress.update(i + 1);
  }
  progress.done(errors > 0 ? `${errors} errors` : '');
}

async function refreshEdited(
  fullDir: string,
  thumbDir: string,
  libraryPath: string
): Promise<void> {
  const db = openPhotosDb(libraryPath);
  const edited = queryEdited(db);
  db.close();

  const existingUuids = getExportedUuids(fullDir);
  const toRefresh = edited.filter((r) => existingUuids.has(r.uuid));
  console.log(
    `Edited: ${edited.length} total, ${toRefresh.length} already exported`
  );
  if (toRefresh.length === 0) return;

  const progress = new Progress(toRefresh.length, 'Re-exporting edited: ');
  let replaced = 0;
  for (let i = 0; i < toRefresh.length; i++) {
    const record = toRefresh[i]!;
    // eslint-disable-next-line no-await-in-loop -- sequential file operations
    const ok = await exportEditedPhoto(record, fullDir, libraryPath);
    if (ok) {
      try {
        unlinkSync(join(thumbDir, `${record.uuid}.jpg`));
      } catch {
        /* ignore */
      }
      replaced++;
    }
    progress.update(i + 1);
  }
  progress.done(`${replaced} replaced`);
}

// ---------- Build items.json ----------

function buildItemsJson(
  photos: PhotoRecord[],
  videos: PhotoRecord[],
  fullDir: string
): ItemEntry[] {
  const exportedUuids = getExportedUuids(fullDir);
  console.log(
    `Building items.json (${photos.length} photos, ${videos.length} videos, ${exportedUuids.size} exported)...`
  );
  const entries: ItemEntry[] = [];
  for (const record of [...photos, ...videos]) {
    if (exportedUuids.has(record.uuid)) entries.push(buildItemEntry(record));
  }
  sortEntries(entries);
  return entries;
}

// ---------- Verify ----------

function printUuidList(label: string, uuids: string[]): void {
  if (uuids.length === 0) return;
  console.log(`\n${label} (${uuids.length}):`);
  for (const uuid of uuids) console.log(`  ${uuid}`);
}

function verify(): void {
  if (!existsSync(JSON_PATH)) {
    console.error(`Error: ${JSON_PATH} not found`);
    process.exit(1);
  }
  const items = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as ItemEntry[];
  const jsonUuids = new Set(items.map((i) => i.uuid));
  const fullFiles = getExportedUuids(FULL_DIR);
  const thumbFiles = getExportedUuids(THUMB_DIR);

  console.log(
    `items.json: ${jsonUuids.size} entries (${items.filter((i) => i.type === 'photo').length} photos, ${items.filter((i) => i.type === 'video').length} videos)`
  );
  console.log(`Full-size:   ${fullFiles.size} files`);
  console.log(`Thumbnails:  ${thumbFiles.size} files`);

  const missingFull = [...jsonUuids].filter((u) => !fullFiles.has(u)).sort();
  const missingThumb = [...jsonUuids].filter((u) => !thumbFiles.has(u)).sort();
  const orphans = [
    ...new Set([
      ...[...fullFiles].filter((u) => !jsonUuids.has(u)),
      ...[...thumbFiles].filter((u) => !jsonUuids.has(u))
    ])
  ].sort();

  printUuidList('Missing full-size', missingFull);
  printUuidList('Missing thumbnails', missingThumb);
  printUuidList('Orphan files', orphans);

  const hasIssues =
    missingFull.length > 0 || missingThumb.length > 0 || orphans.length > 0;
  if (!hasIssues) {
    console.log('\nAll OK');
  } else if (missingFull.length > 0 || missingThumb.length > 0) {
    console.log(
      `\nIssues: ${missingFull.length} missing full, ${missingThumb.length} missing thumb`
    );
    process.exit(1);
  }
}

// ---------- CLI ----------

function clearDirectory(dir: string): void {
  for (const f of readdirSync(dir)) unlinkSync(join(dir, f));
}

function filterByAlbum(
  photos: PhotoRecord[],
  videos: PhotoRecord[],
  album: string | undefined
): { photos: PhotoRecord[]; videos: PhotoRecord[] } {
  if (album === undefined) return { photos, videos };
  const fp = photos.filter((p) => p.albums.includes(album));
  const fv = videos.filter((v) => v.albums.includes(album));
  console.log(`Album "${album}": ${fp.length} photos, ${fv.length} videos`);
  return { photos: fp, videos: fv };
}

async function runExport(): Promise<void> {
  const libraryPath = defaultLibraryPath();
  const args = process.argv.slice(2);
  const albumIdx = args.indexOf('--album');
  const album = albumIdx >= 0 ? args[albumIdx + 1] : undefined;

  mkdirSync(FULL_DIR, { recursive: true });
  mkdirSync(THUMB_DIR, { recursive: true });

  if (args.includes('--full')) {
    console.log('Full re-export: clearing existing files...');
    clearDirectory(FULL_DIR);
    clearDirectory(THUMB_DIR);
  }

  const db = openPhotosDb(libraryPath);
  const allPhotos = queryPhotos(db);
  const allVideos = queryVideos(db);
  db.close();
  console.log(`Found ${allPhotos.length} photos, ${allVideos.length} videos`);

  if (allPhotos.length === 0 && allVideos.length === 0) {
    console.log('No items found. Make sure you have:');
    console.log('  1. Granted Full Disk Access to Terminal');
    console.log('  2. Photos in your Apple Photos library');
    return;
  }

  const filtered = filterByAlbum(allPhotos, allVideos, album);
  const existingUuids = getExportedUuids(FULL_DIR);
  const photoExportFn = (r: PhotoRecord, d: string, l: string) =>
    r.hasEdits ? exportEditedPhoto(r, d, l) : exportPhoto(r, d, l);

  if (filtered.photos.length > 0) {
    await exportBatch({
      records: filtered.photos,
      fullDir: FULL_DIR,
      libraryPath,
      existingUuids,
      label: 'Photos',
      exportFn: photoExportFn
    });
  }
  if (args.includes('--refresh-edited')) {
    await refreshEdited(FULL_DIR, THUMB_DIR, libraryPath);
  }
  if (filtered.videos.length > 0) {
    await exportBatch({
      records: filtered.videos,
      fullDir: FULL_DIR,
      libraryPath,
      existingUuids,
      label: 'Videos',
      exportFn: exportVideoFrame
    });
  }

  await createThumbnails(FULL_DIR, THUMB_DIR);

  if (album === undefined) {
    const entries = buildItemsJson(allPhotos, allVideos, FULL_DIR);
    await writeItemsJson(entries, JSON_PATH);
    const pc = entries.filter((e) => e.type === 'photo').length;
    const vc = entries.filter((e) => e.type === 'video').length;
    console.log(
      `\nExported ${entries.length} items (${pc} photos, ${vc} videos)`
    );
    console.log(`Items JSON: ${JSON_PATH}`);
  } else {
    console.log(
      `\nAlbum export done. Run without --album to rebuild items.json.`
    );
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--verify')) {
    verify();
    return;
  }
  await runExport();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
