/**
 * Shared types and helpers for building item entries.
 *
 * Used by sync.ts and app-db.ts.
 */

import { dateToUtc } from './date-utils';
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
function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds === 0) return null;
  const s = Math.trunc(seconds);
  if (s < 3600) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}


/** Sort albums and albumUuids together alphabetically by album name. */
function sortedAlbums(record: PhotoRecord): {
  albums: string[];
  albumUuids: string[];
} {
  const pairs = record.albums.map((name, i) => ({
    name: name.normalize('NFC'),
    uuid: record.albumUuids[i] ?? DEFAULT_ALBUM_UUID
  }));
  pairs.sort((a, b) => a.name.localeCompare(b.name));
  return {
    albums: pairs.map((p) => p.name),
    albumUuids: pairs.map((p) => p.uuid)
  };
}

/** Build a single item entry from a PhotoRecord. */
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
    camera: record.camera
  };

  const tail = {
    gps: record.gps,
    gps_accuracy: record.gps_accuracy,
    albums: sorted.albums,
    photos_url: photosUrl
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
