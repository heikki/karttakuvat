import type { Photo } from './types';
import { compareDates, getYear } from './utils';

export const state = {
  photos: [] as Photo[],
  filteredPhotos: [] as Photo[],
  filters: {
    year: 'all',
    gps: ['exif', 'inferred', 'user', 'none'] as string[],
    media: ['photo', 'video'] as string[],
    album: 'all'
  },
  pendingEdits: new Map<string, { lat: number; lon: number }>(),
  pendingTimeEdits: new Map<string, number>()
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
    applyFilters(
      state.filters.year,
      state.filters.gps,
      state.filters.media,
      state.filters.album
    );
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
  const count = state.pendingEdits.size + state.pendingTimeEdits.size;
  editListeners.forEach((fn) => {
    fn(count);
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
  state.pendingTimeEdits.clear();
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

export function addPendingTimeEdit(uuid: string, hours: number) {
  const current = state.pendingTimeEdits.get(uuid) ?? 0;
  const total = current + hours;
  if (total === 0) {
    state.pendingTimeEdits.delete(uuid);
  } else {
    state.pendingTimeEdits.set(uuid, total);
  }
  notifyEdits();
}

export function getPendingTimeEdits(): Array<{ uuid: string; hours: number }> {
  return Array.from(state.pendingTimeEdits.entries()).map(([uuid, hours]) => ({
    uuid,
    hours
  }));
}

const datePattern =
  /^(?<yr>\d{4}):(?<mo>\d{2}):(?<dy>\d{2}) (?<hr>\d{2}):(?<mi>\d{2}):(?<sc>\d{2})$/v;

export function applyHourOffset(dateStr: string, hours: number): string {
  if (dateStr === '' || hours === 0) return dateStr;
  const match = datePattern.exec(dateStr);
  if (match?.groups === undefined) return dateStr;
  const { yr, mo, dy, hr, mi, sc } = match.groups;
  const d = new Date(
    parseInt(yr!, 10),
    parseInt(mo!, 10) - 1,
    parseInt(dy!, 10),
    parseInt(hr!, 10),
    parseInt(mi!, 10),
    parseInt(sc!, 10)
  );
  d.setHours(d.getHours() + hours);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
  year: string,
  gps: string[],
  media: string[],
  album = 'all'
) {
  state.filters.year = year;
  state.filters.gps = gps;
  state.filters.media = media;
  state.filters.album = album;

  state.filteredPhotos = state.photos.filter((p) => {
    if (year !== 'all' && getYear(p) !== year) return false;
    if (!matchesGps(p, gps)) return false;
    if (!matchesMedia(p, media)) return false;
    if (album !== 'all' && !p.albums.includes(album)) return false;
    return true;
  });

  notify();
}
