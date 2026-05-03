import { computed, signal } from '@lit-labs/signals';

import type { Photo } from './types';
import { getYear, sortByDate } from './utils';

export interface Filters {
  year: string;
  gps: string[];
  media: string[];
  album: string;
  camera: string;
}

export const photos = signal<Photo[]>([]);

export const filters = signal<Filters>({
  year: 'all',
  gps: ['exif', 'inferred', 'user'],
  media: ['photo', 'video'],
  album: 'all',
  camera: 'all'
});

function matchesGps(p: Photo, gps: string[]): boolean {
  if (gps.length === 0) return false;
  const allValues = ['exif', 'inferred', 'user', 'none'];
  if (gps.length === allValues.length) return true;
  if (p.gps === null) return gps.includes('none');
  return gps.includes(p.gps);
}

function matchesMedia(p: Photo, media: string[]): boolean {
  if (media.length === 0) return false;
  const allValues = ['photo', 'video'];
  if (media.length === allValues.length) return true;
  return media.includes(p.type);
}

export const filteredPhotos = computed(() => {
  const ps = photos.get();
  const f = filters.get();
  return ps.filter((p) => {
    if (f.year !== 'all' && getYear(p) !== f.year) return false;
    if (!matchesGps(p, f.gps)) return false;
    if (!matchesMedia(p, f.media)) return false;
    if (f.album !== 'all' && !p.albums.includes(f.album)) return false;
    if (f.camera !== 'all') {
      const pc = p.camera ?? '(unknown)';
      if (pc !== f.camera) return false;
    }
    return true;
  });
});

export async function loadPhotos() {
  try {
    const response = await fetch(`/api/items?t=${Date.now()}`);
    const data = (await response.json()) as Photo[];
    sortByDate(data);
    photos.set(data);
  } catch (error) {
    console.error('Error loading items:', error);
    throw error;
  }
}
