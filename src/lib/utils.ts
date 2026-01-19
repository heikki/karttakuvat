import type { Photo } from './types';

export function getYear(photo: Photo): string | null {
  if (photo.date === '') return null;
  return photo.date.split(':')[0] ?? null;
}

export function compareDates(a: Photo, b: Photo): number {
  if (a.date === '' && b.date === '') return 0;
  if (a.date === '') return 1;
  if (b.date === '') return -1;
  return a.date.localeCompare(b.date);
}

export function formatDate(dateStr: string): string {
  if (dateStr === '') return 'Unknown date';
  // Input format: "YYYY:MM:DD HH:MM:SS" -> Output: "D.M.YYYY HH:MM"
  const [datePart, timePart] = dateStr.split(' ');
  if (datePart === undefined || datePart === '') return dateStr;
  const parts = datePart.split(':');
  if (
    parts.length >= 3 &&
    parts[0] !== undefined &&
    parts[1] !== undefined &&
    parts[2] !== undefined
  ) {
    const date = `${parseInt(parts[2], 10)}.${parseInt(parts[1], 10)}.${parts[0]}`;
    if (timePart !== undefined && timePart !== '') {
      const [hours, minutes] = timePart.split(':');
      if (hours !== undefined && minutes !== undefined) {
        return `${date} ${hours}:${minutes}`;
      }
    }
    return date;
  }
  return dateStr;
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
