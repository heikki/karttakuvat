/**
 * Per-album file visibility, persisted as `_files.json` sidecars next to each
 * album's GPX/markdown files (mirrors the `_route.json` precedent).
 *
 * Replaces the SQLite `album_files` table.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AlbumFileInfo {
  visible: boolean;
}

const SIDECAR_NAME = '_files.json';

function sidecarPath(dataDir: string, album: string): string {
  return join(dataDir, 'albums', album, SIDECAR_NAME);
}

function load(dataDir: string, album: string): Record<string, AlbumFileInfo> {
  const path = sidecarPath(dataDir, album);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<
      string,
      AlbumFileInfo
    >;
  } catch {
    return {};
  }
}

function save(
  dataDir: string,
  album: string,
  store: Record<string, AlbumFileInfo>
): void {
  const dir = join(dataDir, 'albums', album);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SIDECAR_NAME), JSON.stringify(store));
}

export function getAlbumFiles(
  dataDir: string,
  album: string
): Map<string, AlbumFileInfo> {
  const store = load(dataDir, album);
  const map = new Map<string, AlbumFileInfo>();
  for (const [filename, info] of Object.entries(store)) {
    map.set(filename, info);
  }
  return map;
}

export function setFileVisible(
  dataDir: string,
  album: string,
  filename: string,
  visible: boolean
): void {
  const store = load(dataDir, album);
  store[filename] = { visible };
  save(dataDir, album, store);
}

export function deleteAlbumFile(
  dataDir: string,
  album: string,
  filename: string
): void {
  const store = load(dataDir, album);
  if (!(filename in store)) return;
  const { [filename]: _removed, ...rest } = store;
  save(dataDir, album, rest);
}
