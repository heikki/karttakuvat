import type { Photo } from './types';
import { compareDates, getYear } from './utils';

export const state = {
  photos: [] as Photo[],
  filteredPhotos: [] as Photo[],
  filters: {
    year: 'all',
    gps: 'all',
    media: 'all'
  },
  pendingEdits: new Map<string, { lat: number; lon: number }>()
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
    const response = await fetch(`items.json?t=${Date.now()}`);
    const data = (await response.json()) as Photo[];
    data.sort(compareDates);
    state.photos = data;
    applyFilters(state.filters.year, state.filters.gps, state.filters.media);
  } catch (error) {
    console.error('Error loading items.json:', error);
    throw error;
  }
}

// Edit listeners (separate from filter listeners)
type EditListener = (count: number) => void;
const editListeners: EditListener[] = [];

export function subscribeEdits(fn: EditListener) {
  editListeners.push(fn);
  return () => {
    const index = editListeners.indexOf(fn);
    if (index > -1) editListeners.splice(index, 1);
  };
}

function notifyEdits() {
  editListeners.forEach((fn) => {
    fn(state.pendingEdits.size);
  });
}

export function addPendingEdit(uuid: string, lat: number, lon: number) {
  state.pendingEdits.set(uuid, { lat, lon });
  notifyEdits();
  // Re-notify filter listeners so map updates marker positions
  notify();
}

export function clearPendingEdits() {
  state.pendingEdits.clear();
  notifyEdits();
  notify();
}

export function getPendingEdits(): Array<{
  uuid: string;
  lat: number;
  lon: number;
}> {
  return Array.from(state.pendingEdits.entries()).map(([uuid, coords]) => ({
    uuid,
    ...coords
  }));
}

// Copied location for paste
let copiedLocation: { lat: number; lon: number } | null = null;

export function copyLocation(lat: number, lon: number) {
  copiedLocation = { lat, lon };
}

export function getCopiedLocation(): { lat: number; lon: number } | null {
  return copiedLocation;
}

export function applyFilters(year: string, gps: string, media: string) {
  state.filters.year = year;
  state.filters.gps = gps;
  state.filters.media = media;

  state.filteredPhotos = state.photos.filter((p) => {
    // Year filter
    if (year !== 'all' && getYear(p) !== year) {
      return false;
    }
    // GPS filter
    if (gps === 'none') {
      if (p.gps !== null) return false;
    } else if (gps !== 'all' && p.gps !== gps) {
      return false;
    }
    // Media type filter
    if (media !== 'all' && p.type !== media) {
      return false;
    }
    return true;
  });

  notify();
}
