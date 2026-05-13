/**
 * IANA timezone resolution for photo locations.
 *
 * - geo-tz turns coordinates into an IANA name.
 * - Intl.DateTimeFormat resolves the offset at a given date (DST-aware).
 *
 * Photos.sqlite's ZTIMEZONEOFFSET column stores raw GPS-derived offsets that
 * aren't proper IANA offsets, so callers always recompute from coords when
 * available — see item-store.ts buildItemEntry.
 */

import { exifDatePattern } from './date-utils';

// Use require() for geo-tz: its CJS build declares ESM exports incorrectly,
// causing bundler failures in Electrobun's Bun version.
// Use geo-tz/all (comprehensive dataset) so Iceland returns Atlantic/Reykjavik
// instead of Africa/Abidjan (the default "alike since 1970" dataset merges
// timezones with identical rules and picks the highest-population one).
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports -- CJS interop
const { find: geoTzFind } = require('geo-tz/all') as typeof import('geo-tz');

/** Get IANA timezone name from coordinates. Returns e.g. "Europe/Helsinki". */
export function tzNameFromCoords(lat: number, lon: number): string | null {
  const results = geoTzFind(lat, lon);
  return results[0] ?? null;
}

/**
 * Get UTC offset string (e.g. "+03:00") from coordinates and local date.
 * Accounts for DST at the given date.
 */
export function tzOffsetFromCoords(
  lat: number,
  lon: number,
  dateStr: string
): string | null {
  if (dateStr === '') return null;
  const tzName = tzNameFromCoords(lat, lon);
  if (tzName === null) return null;
  return tzOffsetFromTzName(tzName, dateStr);
}

/**
 * Get UTC offset string from IANA timezone name and local date string.
 * dateStr format: "YYYY:MM:DD HH:MM:SS"
 */
export function tzOffsetFromTzName(
  tzName: string,
  dateStr: string
): string | null {
  try {
    const match = exifDatePattern.exec(dateStr);
    if (match?.groups === undefined) return null;
    const { yr, mo, dy, hr, mi } = match.groups;

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzName,
      timeZoneName: 'longOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const utcDate = new Date(`${yr}-${mo}-${dy}T${hr}:${mi}:00Z`);
    const parts = formatter.formatToParts(utcDate);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart === undefined) return null;

    // tzPart.value is like "GMT+03:00" or "GMT-05:00" or "GMT"
    const gmtMatch = /^GMT(?<offset>[+\-]\d{2}:\d{2})?$/v.exec(tzPart.value);
    if (gmtMatch === null) return null;
    return gmtMatch.groups?.offset ?? '+00:00';
  } catch {
    return null;
  }
}
