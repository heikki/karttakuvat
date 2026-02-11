import type { Photo } from './types';

export function getYear(photo: Photo): string | null {
  if (photo.date === '') return null;
  return photo.date.split(':')[0] ?? null;
}

function toUtcSortKey(date: string, tz: string | null): string {
  const iso = date
    .replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
    .replace(' ', 'T');
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

function formatTz(tz: string): string {
  // "+03:00" -> "+3", "-05:30" -> "-5:30", "+00:00" -> "UTC"
  const match = tz.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return tz;
  const hours = parseInt(match[2]!, 10);
  const minutes = match[3]!;
  if (hours === 0 && minutes === '00') return 'UTC';
  const short = `${match[1]}${hours}`;
  return minutes !== '00' ? `${short}:${minutes}` : short;
}

export function formatDate(dateStr: string, tz?: string | null): string {
  if (dateStr === '') return 'Unknown date';
  // Input format: "YYYY:MM:DD HH:MM:SS" -> Output: "D.M.YYYY HH:MM"
  const [datePart, timePart] = dateStr.split(' ');
  if (datePart === undefined || datePart === '') return dateStr;
  const formattedDate = parseDatePart(datePart);
  if (formattedDate === null) return dateStr;
  const base = formattedDate + parseTimePart(timePart);
  if (tz) return `${base} ${formatTz(tz)}`;
  return base;
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

const exifDatePattern =
  /^(?<yr>\d{4}):(?<mo>\d{2}):(?<dy>\d{2}) (?<hr>\d{2}):(?<mi>\d{2}):(?<sc>\d{2})$/v;

export function parseExifDate(dateStr: string): Date | null {
  const match = exifDatePattern.exec(dateStr);
  if (match?.groups === undefined) return null;
  const { yr, mo, dy, hr, mi, sc } = match.groups;
  return new Date(
    parseInt(yr!, 10),
    parseInt(mo!, 10) - 1,
    parseInt(dy!, 10),
    parseInt(hr!, 10),
    parseInt(mi!, 10),
    parseInt(sc!, 10)
  );
}

export function computeDateOffsetHours(
  originalDateStr: string,
  targetDatePart: string
): number | null {
  const orig = parseExifDate(originalDateStr);
  if (orig === null) return null;
  const parts = targetDatePart.split(':');
  if (parts.length < 3) return null;
  const target = new Date(
    parseInt(parts[0]!, 10),
    parseInt(parts[1]!, 10) - 1,
    parseInt(parts[2]!, 10),
    orig.getHours(),
    orig.getMinutes(),
    orig.getSeconds()
  );
  return (target.getTime() - orig.getTime()) / 3600000;
}

export function computeFullDatetimeOffsetHours(
  originalDateStr: string,
  targetDatetime: Date
): number | null {
  const orig = parseExifDate(originalDateStr);
  if (orig === null) return null;
  return (targetDatetime.getTime() - orig.getTime()) / 3600000;
}

const userDatePattern =
  /^(?<dy>\d{1,2})\.(?<mo>\d{1,2})\.(?<yr>\d{4})?\s*(?<tm>\d{1,2}:\d{2})?$/v;

export function parseUserDatetime(
  input: string,
  fallbackYear: number
): { day: string; time: string | null } | null {
  const trimmed = input.trim();
  const match = userDatePattern.exec(trimmed);
  if (match?.groups === undefined) return null;
  const day = parseInt(match.groups.dy!, 10);
  const month = parseInt(match.groups.mo!, 10);
  const year =
    match.groups.yr !== undefined && match.groups.yr !== ''
      ? parseInt(match.groups.yr, 10)
      : fallbackYear;
  const time =
    match.groups.tm !== undefined && match.groups.tm !== ''
      ? match.groups.tm
      : null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { day: `${year}:${pad(month)}:${pad(day)}`, time };
}
