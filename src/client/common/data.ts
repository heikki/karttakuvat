import type { Photo } from './types';
import { getYear, sortByDate } from './utils';

export const state = {
  photos: [] as Photo[],
  filteredPhotos: [] as Photo[],
  filters: {
    year: 'all',
    gps: ['exif', 'inferred', 'user'] as string[],
    media: ['photo', 'video'] as string[],
    album: 'all',
    camera: 'all'
  }
};

type Listener = (filtered: Photo[]) => void;
const listeners: Listener[] = [];

export function subscribe(fn: Listener) {
  listeners.push(fn);
  return () => {
    const index = listeners.indexOf(fn);
    if (index > -1) listeners.splice(index, 1);
  };
}

function notify() {
  listeners.forEach((fn) => {
    fn(state.filteredPhotos);
  });
}

export async function loadPhotos() {
  try {
    const response = await fetch(`/api/items?t=${Date.now()}`);
    const data = (await response.json()) as Photo[];
    sortByDate(data);
    state.photos = data;
    applyFilters({
      year: state.filters.year,
      gps: state.filters.gps,
      media: state.filters.media,
      album: state.filters.album,
      camera: state.filters.camera
    });
  } catch (error) {
    console.error('Error loading items:', error);
    throw error;
  }
}

let copiedLocation: { lat: number; lon: number } | null = null;

export function copyLocation(lat: number, lon: number) {
  copiedLocation = { lat, lon };
}

export function getCopiedLocation(): { lat: number; lon: number } | null {
  return copiedLocation;
}

let copiedDate: string | null = null;

export function copyDate(datePart: string) {
  copiedDate = datePart;
}

export function getCopiedDate(): string | null {
  return copiedDate;
}

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

export function applyFilters(
  filters: {
    year: string;
    gps: string[];
    media: string[];
    album?: string;
    camera?: string;
  },
  /** Pre-filtered subset (already filtered by year/album/camera) to avoid redundant work. */
  preFiltered?: Photo[]
) {
  state.filters.year = filters.year;
  state.filters.gps = filters.gps;
  state.filters.media = filters.media;
  state.filters.album = filters.album ?? 'all';
  state.filters.camera = filters.camera ?? 'all';

  if (preFiltered === undefined) {
    const { year, album, camera } = state.filters;
    state.filteredPhotos = state.photos.filter((p) => {
      if (year !== 'all' && getYear(p) !== year) return false;
      if (!matchesGps(p, state.filters.gps)) return false;
      if (!matchesMedia(p, state.filters.media)) return false;
      if (album !== 'all' && !p.albums.includes(album)) return false;
      if (camera !== 'all') {
        const pc = p.camera ?? '(unknown)';
        if (pc !== camera) return false;
      }
      return true;
    });
  } else {
    state.filteredPhotos = preFiltered.filter((p) => {
      if (!matchesGps(p, state.filters.gps)) return false;
      if (!matchesMedia(p, state.filters.media)) return false;
      return true;
    });
  }

  notify();
}
