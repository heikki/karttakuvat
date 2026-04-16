/**
 * Stream original video files from the Apple Photos library with HTTP range support.
 *
 * No conversion or copying — the webview plays the original `.mov`/`.mp4`
 * directly via sendfile(2). Seeking works via standard Range requests.
 */

import { homedir } from 'node:os';
import { extname, join } from 'node:path';

import type { AssetRecord } from './photos-db';

function videoMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.m4v') return 'video/x-m4v';
  return 'video/mp4';
}

function parseRange(
  header: string,
  size: number
): { start: number; end: number } | null {
  const match = /^bytes=(?<start>\d*)-(?<end>\d*)$/.exec(header);
  if (match?.groups === undefined) return null;
  const { start: s, end: e } = match.groups;
  const start = s === '' ? 0 : parseInt(s!, 10);
  const end = e === '' ? size - 1 : Math.min(parseInt(e!, 10), size - 1);
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start > end ||
    start >= size ||
    start < 0
  ) {
    return null;
  }
  return { start, end };
}

export function defaultLibraryPath(): string {
  return join(homedir(), 'Pictures/Photos Library.photoslibrary');
}

/** Serve the original video for a UUID, honoring the Range header for seeking. */
export async function serveVideo(
  libraryPath: string,
  asset: AssetRecord | undefined,
  req: Request
): Promise<Response | null> {
  if (asset?.type !== 'video') return null;
  if (asset.directory === null || asset.filename === null) return null;

  const filePath = join(
    libraryPath,
    'originals',
    asset.directory,
    asset.filename
  );
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) return null;

  const size = file.size;
  const contentType = videoMimeType(asset.filename);
  const rangeHeader = req.headers.get('range');

  if (rangeHeader === null) {
    return new Response(file, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes'
      }
    });
  }

  const range = parseRange(rangeHeader, size);
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` }
    });
  }

  const chunkSize = range.end - range.start + 1;
  return new Response(file.slice(range.start, range.end + 1), {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(chunkSize),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes'
    }
  });
}
