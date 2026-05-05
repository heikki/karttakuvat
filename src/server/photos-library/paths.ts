/**
 * Bundle-layout helpers for the Apple Photos library on disk.
 *
 * The .photoslibrary bundle stores originals under `originals/<dir>/<file>`
 * and edited renditions under `resources/renders/<dir>/<file>` (with a
 * potentially different extension). This module owns that layout knowledge
 * so other modules don't need to reach into the bundle structure.
 *
 * Internal to photos-library/.
 */

import { existsSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

export const PHOTO_EDIT_EXT = /\.(?:jpe?g|heic|heif|tiff?)$/i;
export const VIDEO_EDIT_EXT = /\.(?:mov|mp4|m4v)$/i;

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
  filename: string | null,
  extPattern: RegExp
): string | null {
  if (directory === null || filename === null) return null;
  const rendersDir = join(libraryPath, 'resources', 'renders', directory);
  if (!existsSync(rendersDir)) return null;

  const stem = basename(filename, extname(filename));
  try {
    const files = readdirSync(rendersDir);
    const rendered = files.find(
      (f) => f.startsWith(stem) && extPattern.test(f)
    );
    if (rendered !== undefined) return join(rendersDir, rendered);
  } catch {
    // Directory not readable
  }
  return null;
}
