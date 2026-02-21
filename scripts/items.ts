/**
 * Shared helpers for building and writing items.json.
 *
 * Used by both export.ts and sync.ts to avoid duplication.
 */

import type { PhotoRecord } from './photos-db';
import { tzOffsetFromTzName } from './photos-edit';

export interface ItemEntry {
  uuid: string;
  type: 'photo' | 'video';
  full: string;
  thumb: string;
  lat: number | null;
  lon: number | null;
  date: string;
  tz: string | null;
  camera: string | null;
  duration?: string | null;
  gps: 'user' | 'exif' | 'inferred' | null;
  gps_accuracy: number | null;
  albums: string[];
  photos_url: string;
}

const DEFAULT_ALBUM_UUID = '81938C84-C5B0-4258-BC19-0B3EFA9BF296';

/** Format duration in seconds to "M:SS" or "H:MM:SS". */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds === 0) return null;
  const s = Math.round(seconds);
  if (s < 3600) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Convert local date + tz offset to UTC sortable string. */
export function dateToUtc(dateStr: string, tz: string | null): string {
  if (dateStr === '' || tz === null || tz === '') return dateStr;
  try {
    const match =
      /^(?<yr>\d{4}):(?<mo>\d{2}):(?<dy>\d{2}) (?<hr>\d{2}):(?<mi>\d{2}):(?<sc>\d{2})$/v.exec(
        dateStr
      );
    if (match?.groups === undefined) return dateStr;
    const { yr, mo, dy, hr, mi, sc } = match.groups;
    const sign = tz.startsWith('+') ? 1 : -1;
    const tzH = parseInt(tz.slice(1, 3), 10);
    const tzM = parseInt(tz.slice(4, 6), 10);
    const offsetMs = sign * (tzH * 3600000 + tzM * 60000);

    const d = new Date(
      Date.UTC(
        parseInt(yr, 10),
        parseInt(mo, 10) - 1,
        parseInt(dy, 10),
        parseInt(hr, 10),
        parseInt(mi, 10),
        parseInt(sc, 10)
      ) - offsetMs
    );

    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  } catch {
    return dateStr;
  }
}

/** Build a single items.json entry from a PhotoRecord. */
export function buildItemEntry(record: PhotoRecord): ItemEntry {
  const albumUuid = record.albumUuids[0] ?? DEFAULT_ALBUM_UUID;
  const photosUrl = `photos:albums?albumUuid=${albumUuid}&assetUuid=${record.uuid}`;

  // Fall back to Europe/Helsinki if tz is missing but date exists
  const tz =
    record.tz ??
    (record.date === ''
      ? null
      : tzOffsetFromTzName('Europe/Helsinki', record.date));

  const entry: ItemEntry = {
    uuid: record.uuid,
    type: record.type,
    full: `full/${record.uuid}.jpg`,
    thumb: `thumb/${record.uuid}.jpg`,
    lat: record.lat,
    lon: record.lon,
    date: record.date,
    tz,
    camera: record.camera,
    gps: record.gps,
    gps_accuracy: record.gps_accuracy,
    albums: record.albums,
    photos_url: photosUrl
  };

  if (record.type === 'video') {
    entry.duration = formatDuration(record.duration);
  }

  return entry;
}

/** Sort entries by UTC time, then UUID for deterministic order. */
export function sortEntries(entries: ItemEntry[]): void {
  entries.sort((a, b) => {
    const d = dateToUtc(a.date, a.tz).localeCompare(dateToUtc(b.date, b.tz));
    return d === 0 ? a.uuid.localeCompare(b.uuid) : d;
  });
}

/** Write items.json and format with prettier. */
export async function writeItemsJson(
  entries: ItemEntry[],
  jsonPath: string
): Promise<void> {
  await Bun.write(jsonPath, `${JSON.stringify(entries, null, 2)}\n`);
  const prettier = await import('prettier');
  const raw = await Bun.file(jsonPath).text();
  const formatted = await prettier.format(raw, { parser: 'json' });
  await Bun.write(jsonPath, formatted);
}
