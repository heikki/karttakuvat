import type { Photo } from './types';
import { compareDates, getYear } from './utils';

export const state = {
  photos: [] as Photo[],
  filteredPhotos: [] as Photo[],
  filters: {
    year: 'all',
    gps: 'all'
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
  listeners.forEach((fn) => { fn(state.filteredPhotos); });
}

export async function loadPhotos() {
  try {
    const response = await fetch('photos.json');
    const data: Photo[] = await response.json();
    data.sort(compareDates);
    state.photos = data;
    applyFilters(state.filters.year, state.filters.gps);
  } catch (error) {
    console.error('Error loading photos.json:', error);
    throw error;
  }
}

export function applyFilters(year: string, gps: string) {
  state.filters.year = year;
  state.filters.gps = gps;

  state.filteredPhotos = state.photos.filter((p) => {
    // Year filter
    if (year !== 'all' && getYear(p) !== year) {
      return false;
    }
    // GPS filter
    if (gps !== 'all' && p.gps !== gps) {
      return false;
    }
    return true;
  });

  notify();
}
