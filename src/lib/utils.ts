import type { Photo } from './types';

export function getYear(photo: Photo): string | null {
  if (!photo.date) return null;
  return photo.date.split(':')[0] || null;
}

export function compareDates(a: Photo, b: Photo): number {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return a.date.localeCompare(b.date);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return 'Unknown date';
  // Input format: "YYYY:MM:DD HH:MM:SS" -> Output: "D.M.YYYY HH:MM"
  const [datePart, timePart] = dateStr.split(' ');
  if (!datePart) return dateStr;
  const parts = datePart.split(':');
  if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
    const date = `${parseInt(parts[2])}.${parseInt(parts[1])}.${parts[0]}`;
    if (timePart) {
      const [hours, minutes] = timePart.split(':');
      if (hours && minutes) {
        return `${date} ${hours}:${minutes}`;
      }
    }
    return date;
  }
  return dateStr;
}

export function getThumbUrl(photo: Photo) {
  return photo.thumb || photo.filename || '';
}

export function getFullUrl(photo: Photo) {
  return photo.full || photo.filename || '';
}
