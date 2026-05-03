import * as data from '@common/data';
import { photoFromUrl, photoToUrl } from '@common/filter-url';
import type { Photo } from '@common/types';

type SelectionMode = 'idle' | 'popup' | 'placement';

let mode: SelectionMode = 'idle';
let photoUuid: string | null = null;

type Listener = () => void;
const listeners: Listener[] = [];

function notify(): void {
  for (const fn of [...listeners]) fn();
}

function setState(newMode: SelectionMode, newUuid: string | null): void {
  if (mode === newMode && photoUuid === newUuid) return;
  mode = newMode;
  photoUuid = newUuid;
  photoToUrl(photoUuid);
  notify();
}

function getMode(): SelectionMode {
  return mode;
}

function getPhotoUuid(): string | null {
  return photoUuid;
}

function getPhoto(): Photo | undefined {
  if (photoUuid === null) return undefined;
  return data.state.filteredPhotos.find((p) => p.uuid === photoUuid);
}

function getPhotoIndex(): number | null {
  if (photoUuid === null) return null;
  const idx = data.state.filteredPhotos.findIndex((p) => p.uuid === photoUuid);
  return idx === -1 ? null : idx;
}

function openPopup(uuid: string): void {
  setState('popup', uuid);
}

function next(): boolean {
  const idx = getPhotoIndex();
  if (idx === null) return false;
  const total = data.state.filteredPhotos.length;
  if (total === 0) return false;
  const target = data.state.filteredPhotos[(idx + 1) % total];
  if (target === undefined) return false;
  openPopup(target.uuid);
  return true;
}

function prev(): boolean {
  const idx = getPhotoIndex();
  if (idx === null) return false;
  const total = data.state.filteredPhotos.length;
  if (total === 0) return false;
  const target = data.state.filteredPhotos[(idx - 1 + total) % total];
  if (target === undefined) return false;
  openPopup(target.uuid);
  return true;
}

// Precondition: must be in popup mode with the same uuid.
// (The "set" button is only reachable from an open popup.)
function enterPlacement(uuid: string): void {
  if (mode !== 'popup' || photoUuid !== uuid) return;
  setState('placement', uuid);
}

function clear(): void {
  setState('idle', null);
}

function toggleOldestNewest(): void {
  const photos = data.state.filteredPhotos;
  if (photos.length === 0) return;
  let oldestIdx = 0;
  let newestIdx = 0;
  for (let i = 1; i < photos.length; i++) {
    if (photos[i]!.date < photos[oldestIdx]!.date) oldestIdx = i;
    if (photos[i]!.date > photos[newestIdx]!.date) newestIdx = i;
  }
  if (photoUuid === photos[oldestIdx]!.uuid) {
    openPopup(photos[newestIdx]!.uuid);
  } else if (photoUuid === photos[newestIdx]!.uuid) {
    openPopup(photos[oldestIdx]!.uuid);
  } else if (photoUuid === null) {
    openPopup(photos[oldestIdx]!.uuid);
  }
}

function subscribe(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i > -1) listeners.splice(i, 1);
  };
}

let restoredFromUrl = false;

function tryRestoreFromUrl(): void {
  if (restoredFromUrl) return;
  const uuid = photoFromUrl();
  if (uuid === null) {
    restoredFromUrl = true;
    return;
  }
  if (!data.state.filteredPhotos.some((p) => p.uuid === uuid)) return;
  restoredFromUrl = true;
  openPopup(uuid);
}

function init(): void {
  data.subscribe(() => {
    if (!restoredFromUrl) {
      tryRestoreFromUrl();
      return;
    }
    if (photoUuid === null) return;
    const stillExists = data.state.filteredPhotos.some(
      (p) => p.uuid === photoUuid
    );
    if (stillExists) {
      // Photo still selected, but its data may have moved (pending edit, save).
      notify();
    } else {
      clear();
    }
  });
}

export default {
  getMode,
  getPhotoUuid,
  getPhoto,
  getPhotoIndex,
  openPopup,
  next,
  prev,
  enterPlacement,
  clear,
  toggleOldestNewest,
  subscribe,
  init
};
