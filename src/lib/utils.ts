import type { Photo } from './types';

export function getYear(photo: Photo): string | null {
  if (photo.date === '') return null;
  return photo.date.split(':')[0] ?? null;
}

function toUtcSortKey(date: string, tz: string | null): string {
  const iso = date.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
  return new Date(iso + (tz ?? 'Z')).toISOString();
}

export function compareDates(a: Photo, b: Photo): number {
  if (a.date === '' && b.date === '') return 0;
  if (a.date === '') return 1;
  if (b.date === '') return -1;
  return toUtcSortKey(a.date, a.tz).localeCompare(toUtcSortKey(b.date, b.tz));
}

function parseTimePart(timePart: string | undefined): string {
  if (timePart === undefined || timePart === '') return '';
  const [hours, minutes] = timePart.split(':');
  if (hours !== undefined && minutes !== undefined) {
    return ` ${hours}:${minutes}`;
  }
  return '';
}

function parseDatePart(datePart: string): string | null {
  const parts = datePart.split(':');
  const hasAllParts =
    parts.length >= 3 &&
    parts[0] !== undefined &&
    parts[1] !== undefined &&
    parts[2] !== undefined;
  if (!hasAllParts) return null;
  return `${parseInt(parts[2]!, 10)}.${parseInt(parts[1]!, 10)}.${parts[0]!}`;
}

export function formatDate(dateStr: string): string {
  if (dateStr === '') return 'Unknown date';
  // Input format: "YYYY:MM:DD HH:MM:SS" -> Output: "D.M.YYYY HH:MM"
  const [datePart, timePart] = dateStr.split(' ');
  if (datePart === undefined || datePart === '') return dateStr;
  const formattedDate = parseDatePart(datePart);
  if (formattedDate === null) return dateStr;
  return formattedDate + parseTimePart(timePart);
}

export function isVideo(item: Photo): boolean {
  return item.type === 'video';
}

export function durationSpan(item: Photo): string {
  if (item.duration !== undefined && item.duration !== null) {
    return `<span class="duration">${item.duration}</span>`;
  }
  return '';
}

export function formatLocation(photo: Photo): string {
  if (photo.lat !== null && photo.lon !== null) {
    return `${photo.lat.toFixed(4)}°N, ${photo.lon.toFixed(4)}°E`;
  }
  return 'No location';
}

export function getThumbUrl(photo: Photo): string {
  if (photo.thumb === '') {
    return photo.filename ?? '';
  }
  return photo.thumb;
}

export function getFullUrl(photo: Photo): string {
  if (photo.full === '') {
    return photo.filename ?? '';
  }
  return photo.full;
}
