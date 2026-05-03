import { signal } from '@lit-labs/signals';

import * as data from '@common/data';
import { photoFromUrl, photoToUrl } from '@common/filter-url';
import { effect } from '@common/signals';
import type { Photo } from '@common/types';

export type InteractionMode = 'idle' | 'placement' | 'measure' | 'route-edit';

export const selectedPhotoUuid = signal<string | null>(photoFromUrl());
export const interactionMode = signal<InteractionMode>('idle');

// Persist selectedPhotoUuid to URL. Skip the first run so the seeded
// initial value isn't written back (which would race with URL restoration).
let firstUrlRun = true;
effect(() => {
  const uuid = selectedPhotoUuid.get();
  if (firstUrlRun) {
    firstUrlRun = false;
    return;
  }
  photoToUrl(uuid);
});

function getPhoto(): Photo | undefined {
  const uuid = selectedPhotoUuid.get();
  if (uuid === null) return undefined;
  return data.filteredPhotos.get().find((p) => p.uuid === uuid);
}

function getPhotoIndex(): number | null {
  const uuid = selectedPhotoUuid.get();
  if (uuid === null) return null;
  const idx = data.filteredPhotos.get().findIndex((p) => p.uuid === uuid);
  return idx === -1 ? null : idx;
}

// True iff a photo is selected and the popup should be visible. Placement
// hides the popup so the user can pick a location without it in the way;
// measure and route-edit don't conflict with the popup.
function isPopupOpen(): boolean {
  return (
    selectedPhotoUuid.get() !== null && interactionMode.get() !== 'placement'
  );
}

function selectPhoto(uuid: string): void {
  selectedPhotoUuid.set(uuid);
  // Selecting a different photo cancels placement (placement is bound to
  // the previously-selected photo and no longer makes sense).
  if (interactionMode.get() === 'placement') {
    interactionMode.set('idle');
  }
}

function clear(): void {
  selectedPhotoUuid.set(null);
  interactionMode.set('idle');
}

// Close the popup without touching interactionMode. Used when the user
// dismisses the popup (Esc, click empty map) during measure or route-edit
// mode — those modes shouldn't be exited by a popup-close action.
function closePopup(): void {
  selectedPhotoUuid.set(null);
}

// Enter placement mode for the currently-selected photo. The popup must
// already be open — the "set" button that calls this lives in the popup.
function enterPlacement(): void {
  if (selectedPhotoUuid.get() === null) return;
  interactionMode.set('placement');
}

function next(): boolean {
  const idx = getPhotoIndex();
  if (idx === null) return false;
  const photos = data.filteredPhotos.get();
  if (photos.length === 0) return false;
  const target = photos[(idx + 1) % photos.length];
  if (target === undefined) return false;
  selectPhoto(target.uuid);
  return true;
}

function prev(): boolean {
  const idx = getPhotoIndex();
  if (idx === null) return false;
  const photos = data.filteredPhotos.get();
  if (photos.length === 0) return false;
  const target = photos[(idx - 1 + photos.length) % photos.length];
  if (target === undefined) return false;
  selectPhoto(target.uuid);
  return true;
}

function toggleOldestNewest(): void {
  const photos = data.filteredPhotos.get();
  if (photos.length === 0) return;
  let oldestIdx = 0;
  let newestIdx = 0;
  for (let i = 1; i < photos.length; i++) {
    if (photos[i]!.date < photos[oldestIdx]!.date) oldestIdx = i;
    if (photos[i]!.date > photos[newestIdx]!.date) newestIdx = i;
  }
  const cur = selectedPhotoUuid.get();
  if (cur === photos[oldestIdx]!.uuid) {
    selectPhoto(photos[newestIdx]!.uuid);
  } else if (cur === photos[newestIdx]!.uuid) {
    selectPhoto(photos[oldestIdx]!.uuid);
  } else if (cur === null) {
    selectPhoto(photos[oldestIdx]!.uuid);
  }
}

let restoredFromUrl = false;

function init(): void {
  effect(() => {
    const filtered = data.filteredPhotos.get();
    if (!restoredFromUrl) {
      const uuid = photoFromUrl();
      if (uuid === null) {
        restoredFromUrl = true;
        return;
      }
      if (filtered.some((p) => p.uuid === uuid)) {
        restoredFromUrl = true;
        // Signal already seeded from URL — no .set() needed.
      }
      return;
    }
    const cur = selectedPhotoUuid.get();
    if (cur === null) return;
    if (!filtered.some((p) => p.uuid === cur)) clear();
  });
}

export default {
  selectedPhotoUuid,
  interactionMode,
  getPhoto,
  getPhotoIndex,
  isPopupOpen,
  selectPhoto,
  clear,
  closePopup,
  enterPlacement,
  next,
  prev,
  toggleOldestNewest,
  init
};
