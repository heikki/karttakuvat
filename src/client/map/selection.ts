import { state, subscribe as subscribeData } from '@common/data';
import { photoFromUrl, photoToUrl } from '@common/filter-url';
import type { Photo } from '@common/types';

export type SelectionMode = 'idle' | 'popup' | 'placement';

export interface SelectionState {
  readonly mode: SelectionMode;
  readonly photoUuid: string | null;
}

let mode: SelectionMode = 'idle';
let photoUuid: string | null = null;

type Listener = (s: SelectionState) => void;
const listeners: Listener[] = [];

function snapshot(): SelectionState {
  return { mode, photoUuid };
}

function notify(): void {
  const s = snapshot();
  for (const fn of [...listeners]) fn(s);
}

function setState(newMode: SelectionMode, newUuid: string | null): void {
  if (mode === newMode && photoUuid === newUuid) return;
  mode = newMode;
  photoUuid = newUuid;
  photoToUrl(photoUuid);
  notify();
}

export function getMode(): SelectionMode {
  return mode;
}

export function getPhotoUuid(): string | null {
  return photoUuid;
}

export function getPhoto(): Photo | undefined {
  if (photoUuid === null) return undefined;
  return state.filteredPhotos.find((p) => p.uuid === photoUuid);
}

export function getPhotoIndex(): number | null {
  if (photoUuid === null) return null;
  const idx = state.filteredPhotos.findIndex((p) => p.uuid === photoUuid);
  return idx === -1 ? null : idx;
}

export function openPopup(uuid: string): void {
  setState('popup', uuid);
}

// Precondition: must be in popup mode with the same uuid.
// (The "set" button is only reachable from an open popup.)
export function enterPlacement(uuid: string): void {
  if (mode !== 'popup' || photoUuid !== uuid) return;
  setState('placement', uuid);
}

export function clear(): void {
  setState('idle', null);
}

export function subscribe(fn: Listener): () => void {
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
  if (!state.filteredPhotos.some((p) => p.uuid === uuid)) return;
  restoredFromUrl = true;
  openPopup(uuid);
}

export function initSelection(): void {
  subscribeData(() => {
    if (!restoredFromUrl) {
      tryRestoreFromUrl();
      return;
    }
    if (photoUuid === null) return;
    const stillExists = state.filteredPhotos.some((p) => p.uuid === photoUuid);
    if (stillExists) {
      // Photo still selected, but its data may have moved (pending edit, save).
      notify();
    } else {
      clear();
    }
  });
}
