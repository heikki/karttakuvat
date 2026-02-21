/**
 * Shared helpers for building and writing items.json.
 *
 * Used by both export.ts and sync.ts to avoid duplication.
 */

import type { PhotoRecord } from './photos-db';
import { tzOffsetFromCoords, tzOffsetFromTzName } from './photos-edit';

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
  const s = Math.trunc(seconds);
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

/** Sort albums and albumUuids together alphabetically by album name. */
function sortedAlbums(record: PhotoRecord): { albums: string[]; albumUuids: string[] } {
  const pairs = record.albums.map((name, i) => ({
    name: name.normalize('NFC'),
    uuid: record.albumUuids[i] ?? DEFAULT_ALBUM_UUID,
  }));
  pairs.sort((a, b) => a.name.localeCompare(b.name));
  return {
    albums: pairs.map((p) => p.name),
    albumUuids: pairs.map((p) => p.uuid),
  };
}

/** Build a single items.json entry from a PhotoRecord. */
export function buildItemEntry(record: PhotoRecord): ItemEntry {
  const sorted = sortedAlbums(record);
  const albumUuid = sorted.albumUuids[0] ?? DEFAULT_ALBUM_UUID;
  const photosUrl = `photos:albums?albumUuid=${albumUuid}&assetUuid=${record.uuid}`;

  // Compute timezone from coordinates (matches Python behavior).
  // The database stores raw GPS-derived offsets that aren't proper IANA
  // timezone offsets, so we always recompute from coords when available.
  // Fall back to Europe/Helsinki for items without coordinates.
  let tz: string | null = null;
  if (record.date !== '') {
    if (record.lat !== null && record.lon !== null) {
      tz = tzOffsetFromCoords(record.lat, record.lon, record.date);
    }
    tz ??= tzOffsetFromTzName('Europe/Helsinki', record.date);
  }

  const base = {
    uuid: record.uuid,
    type: record.type,
    full: `full/${record.uuid}.jpg`,
    thumb: `thumb/${record.uuid}.jpg`,
    lat: record.lat,
    lon: record.lon,
    date: record.date,
    tz,
    camera: record.camera,
  };

  const tail = {
    gps: record.gps,
    gps_accuracy: record.gps_accuracy,
    albums: sorted.albums,
    photos_url: photosUrl,
  };

  if (record.type === 'video') {
    return { ...base, duration: formatDuration(record.duration), ...tail };
  }
  const entry: ItemEntry = { ...base, ...tail };
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
