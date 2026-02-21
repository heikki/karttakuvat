/**
 * On-demand image conversion with disk cache.
 *
 * Converts photos/videos from Apple Photos library to JPEG on first access
 * and caches the result. Validates cache by comparing source file mtime.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

import type { AssetRecord } from './photos-db';

export interface ImageCacheConfig {
  cacheDir: string;
  libraryPath?: string;
}

export interface ImageCache {
  resolve: (
    uuid: string,
    size: 'full' | 'thumb',
    asset: AssetRecord
  ) => Promise<string | null>;
  invalidate: (uuid: string) => void;
}

// ---------- Shell helpers ----------

async function run(cmd: string[]): Promise<boolean> {
  const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
  return (await proc.exited) === 0;
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

// ---------- Path resolution ----------

export function resolveOriginalPath(
  libraryPath: string,
  directory: string | null,
  filename: string | null
): string | null {
  if (directory === null || filename === null) return null;
  const p = join(libraryPath, 'originals', directory, filename);
  return existsSync(p) ? p : null;
}

export function resolveEditedPath(
  libraryPath: string,
  directory: string | null,
  filename: string | null
): string | null {
  if (directory === null || filename === null) return null;
  const rendersDir = join(libraryPath, 'resources', 'renders', directory);
  if (!existsSync(rendersDir)) return null;

  const stem = basename(filename, extname(filename));
  try {
    const files = readdirSync(rendersDir);
    const rendered = files.find(
      (f) => f.startsWith(stem) && /\.jpe?g$/i.test(f)
    );
    if (rendered !== undefined) return join(rendersDir, rendered);
  } catch {
    // Directory not readable
  }
  return null;
}

// ---------- Source mtime ----------

function getSourceMtime(
  libraryPath: string,
  asset: AssetRecord
): number | null {
  // For edited assets, check the rendered version first
  if (asset.hasEdits) {
    const editedPath = resolveEditedPath(
      libraryPath,
      asset.directory,
      asset.filename
    );
    if (editedPath !== null) {
      try {
        return statSync(editedPath).mtimeMs;
      } catch {
        // fall through
      }
    }
  }
  const originalPath = resolveOriginalPath(
    libraryPath,
    asset.directory,
    asset.filename
  );
  if (originalPath === null) return null;
  try {
    return statSync(originalPath).mtimeMs;
  } catch {
    return null;
  }
}

// ---------- Conversion ----------

async function convertEditedPhoto(
  libraryPath: string,
  directory: string | null,
  filename: string | null,
  outputPath: string
): Promise<boolean> {
  const renderedPath = resolveEditedPath(libraryPath, directory, filename);
  if (renderedPath !== null) {
    const ext = extname(renderedPath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') {
      copyFileSync(renderedPath, outputPath);
      return true;
    }
    if (await sipsConvert(renderedPath, outputPath)) return true;
  }
  const originalPath = resolveOriginalPath(libraryPath, directory, filename);
  if (originalPath === null) return false;
  return await qlmanageToJpeg(originalPath, outputPath, `${outputPath}.ql_tmp`);
}

async function convertOriginalPhoto(
  originalPath: string,
  outputPath: string
): Promise<boolean> {
  const ext = extname(originalPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    copyFileSync(originalPath, outputPath);
    return true;
  }
  if (ext === '.heic' || ext === '.heif') {
    const tmpPath = `${outputPath}.heic`;
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

async function convertFull(
  libraryPath: string,
  asset: AssetRecord,
  outputPath: string
): Promise<boolean> {
  const { directory, filename } = asset;

  if (asset.type === 'video') {
    const originalPath = resolveOriginalPath(libraryPath, directory, filename);
    if (originalPath === null) return false;
    return await qlmanageToJpeg(
      originalPath,
      outputPath,
      `${outputPath}.ql_tmp`
    );
  }

  if (asset.hasEdits) {
    return await convertEditedPhoto(
      libraryPath,
      directory,
      filename,
      outputPath
    );
  }

  const originalPath = resolveOriginalPath(libraryPath, directory, filename);
  if (originalPath === null) return false;
  return await convertOriginalPhoto(originalPath, outputPath);
}

// ---------- Cache ----------

export function createImageCache(config: ImageCacheConfig): ImageCache {
  const { cacheDir } = config;
  const libraryPath =
    config.libraryPath ??
    join(homedir(), 'Pictures/Photos Library.photoslibrary');

  const fullDir = join(cacheDir, 'full');
  const thumbDir = join(cacheDir, 'thumb');
  mkdirSync(fullDir, { recursive: true });
  mkdirSync(thumbDir, { recursive: true });

  // Per-UUID locks to prevent duplicate concurrent conversions
  const locks = new Map<string, Promise<string | null>>();

  function isCacheValid(cachedPath: string, sourceMtime: number): boolean {
    try {
      const cachedMtime = statSync(cachedPath).mtimeMs;
      return cachedMtime >= sourceMtime;
    } catch {
      return false;
    }
  }

  async function resolveImpl(
    uuid: string,
    size: 'full' | 'thumb',
    asset: AssetRecord
  ): Promise<string | null> {
    const cachedFull = join(fullDir, `${uuid}.jpg`);
    const cachedThumb = join(thumbDir, `${uuid}.jpg`);
    const cachedPath = size === 'full' ? cachedFull : cachedThumb;

    // Check source mtime for cache validation
    const sourceMtime = getSourceMtime(libraryPath, asset);
    if (sourceMtime === null) return null; // source not available (iCloud-only)

    // Cache hit with valid mtime
    if (isCacheValid(cachedPath, sourceMtime)) {
      return cachedPath;
    }

    // Need to convert full-size first (thumb depends on it)
    if (!isCacheValid(cachedFull, sourceMtime)) {
      const ok = await convertFull(libraryPath, asset, cachedFull);
      if (!ok) return null;
      // Stamp cached file mtime to match source
      const now = new Date();
      utimesSync(cachedFull, now, new Date(sourceMtime));
      // Invalidate thumb when full is reconverted
      try {
        unlinkSync(cachedThumb);
      } catch {
        /* ignore */
      }
    }

    // Generate thumbnail if needed
    if (size === 'thumb' && !existsSync(cachedThumb)) {
      const ok = await createThumbnail(cachedFull, cachedThumb);
      if (!ok) return null;
      const now = new Date();
      utimesSync(cachedThumb, now, new Date(sourceMtime));
    }

    return cachedPath;
  }

  async function resolve(
    uuid: string,
    size: 'full' | 'thumb',
    asset: AssetRecord
  ): Promise<string | null> {
    const key = `${uuid}:${size}`;
    const existing = locks.get(key);
    if (existing !== undefined) return await existing;

    const promise = resolveImpl(uuid, size, asset).finally(() => {
      locks.delete(key);
    });
    locks.set(key, promise);
    return await promise;
  }

  function invalidate(uuid: string): void {
    try {
      unlinkSync(join(fullDir, `${uuid}.jpg`));
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(join(thumbDir, `${uuid}.jpg`));
    } catch {
      /* ignore */
    }
  }

  return { resolve, invalidate };
}
