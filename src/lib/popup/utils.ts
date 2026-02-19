import { applyHourOffset, getEffectiveCoords, state } from '../data';
import type { Photo } from '../types';
import {
  computeDateOffsetHours,
  computeFullDatetimeOffsetHours
} from '../utils';

export function getEffectiveDate(photo: Photo): string {
  const offset = state.pendingTimeEdits.get(photo.uuid) ?? 0;
  if (offset === 0) return photo.date;
  return applyHourOffset(photo.date, offset);
}

export function getEffectiveLocation(
  photo: Photo
): { lat: number; lon: number } | null {
  const coords = getEffectiveCoords(photo);
  if (
    photo.lat === null &&
    photo.lon === null &&
    !state.pendingEdits.has(photo.uuid)
  ) {
    return null;
  }
  return coords;
}

export function computeManualDateOffset(
  originalDate: string,
  parsed: { day: string; time: string | null }
): number | null {
  if (parsed.time === null) {
    return computeDateOffsetHours(originalDate, parsed.day);
  }
  const timeParts = parsed.time.split(':').map(Number);
  const dayParts = parsed.day.split(':');
  const target = new Date(
    parseInt(dayParts[0]!, 10),
    parseInt(dayParts[1]!, 10) - 1,
    parseInt(dayParts[2]!, 10),
    timeParts[0] ?? 0,
    timeParts[1] ?? 0,
    0
  );
  return computeFullDatetimeOffsetHours(originalDate, target);
}

export function editableDateStr(exifDate: string): string {
  if (exifDate === '') return '';
  const [datePart, timePart] = exifDate.split(' ');
  if (datePart === undefined) return '';
  const parts = datePart.split(':');
  if (parts.length < 3) return '';
  const d = `${parseInt(parts[2]!, 10)}.${parseInt(parts[1]!, 10)}.${parts[0]!}`;
  if (timePart === undefined) return d;
  const [h, m] = timePart.split(':');
  if (h === undefined || m === undefined) return d;
  return `${d} ${h}:${m}`;
}
