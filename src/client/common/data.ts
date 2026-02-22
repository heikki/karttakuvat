import { apiReady, getApiBase } from './api';
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
  },
  pendingEdits: new Map<string, { lat: number; lon: number }>(),
  pendingTimeEdits: new Map<string, number>(),
  isSaving: false
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
    await apiReady;
    const response = await fetch(`${getApiBase()}/api/items?t=${Date.now()}`);
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

export function setSaving(isSaving: boolean) {
  state.isSaving = isSaving;
  notifyEdits();
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

export function getEffectiveCoords(photo: Photo): { lat: number; lon: number } {
  const pending = state.pendingEdits.get(photo.uuid);
  if (pending !== undefined) return pending;
  return { lat: photo.lat ?? 0, lon: photo.lon ?? 0 };
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

// Copied date for paste (day part only, e.g. "2008:07:09")
let copiedDate: string | null = null;

export function copyDate(datePart: string) {
  copiedDate = datePart;
}

export function getCopiedDate(): string | null {
  return copiedDate;
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

export function setPendingTimeEdit(uuid: string, totalHours: number) {
  if (totalHours === 0) {
    state.pendingTimeEdits.delete(uuid);
  } else {
    state.pendingTimeEdits.set(uuid, totalHours);
  }
  notifyEdits();
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
  d.setTime(d.getTime() + Math.round(hours * 3600000));
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
