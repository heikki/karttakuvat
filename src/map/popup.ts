import { Popup } from 'maplibre-gl';
import type { Map as MapGL } from 'maplibre-gl';

import {
  addPendingEdit,
  addPendingTimeEdit,
  copyDate,
  copyLocation,
  getCopiedDate,
  getCopiedLocation,
  getEffectiveCoords,
  setPendingTimeEdit,
  state
} from '@common/data';
import { ShowLightboxEvent } from '@common/events';
import { photoFromUrl, photoToUrl } from '@common/filter-url';
import {
  computeManualDateOffset,
  getEffectiveDate,
  getEffectiveLocation
} from '@common/photo-utils';
import type { Photo } from '@common/types';
import {
  computeFullDatetimeOffsetHours,
  parseExifDate,
  parseUserDatetime
} from '@common/utils';
import type { PopupActions, PhotoPopup } from '@components/photo-popup';

import {
  initPopupZoom,
  installCanvasZoomOverride,
  removeCanvasZoomOverride,
  setupPopupEvents
} from './popup-zoom';

// State
let currentPopup: Popup | null = null;
let currentPopupElement: PhotoPopup | null = null;
let currentSinglePhotoIndex: number | null = null;
let currentPhotoUuid: string | null = null;
let dateEditMode = false;

// Callbacks that will be set by map.ts
let highlightFn: (photo: Photo | null) => void = () => {
  /* noop */
};
let panToFitPopupFn: (coords: [number, number]) => void = () => {
  /* noop */
};
let map: MapGL | null = null;
let getMarkerRadiusFn: (zoom: number) => number = () => 0;
function popupOffset(): [number, number] {
  const zoom = map?.getZoom() ?? 10;
  const radius = getMarkerRadiusFn(zoom);
  return [0, -(radius * 1.3 + 5)];
}

let reanchoring = false;

function getSelectedMarkerCoords(): [number, number] | null {
  const photo = getCurrentPhoto();
  if (photo === undefined) return null;
  const { lon, lat } = getEffectiveCoords(photo);
  return [lon, lat];
}

export function reanchorPopup() {
  if (currentPopup === null) return;
  if (map === null) return;
  if (!currentPopup.isOpen()) return;
  const lngLat = currentPopup.getLngLat();
  reanchoring = true;
  currentPopup.remove();
  currentPopup.setOffset(popupOffset());
  currentPopup.setLngLat(lngLat).addTo(map);
  setupPopupEvents(currentPopup.getElement());
  reanchoring = false;
}

function handleArrowNav(key: string) {
  if (currentSinglePhotoIndex === null) return false;
  const total = state.filteredPhotos.length;
  const newIdx =
    (currentSinglePhotoIndex + (key === 'ArrowLeft' ? -1 : 1) + total) % total;
  navigateSinglePhoto(newIdx);
  return true;
}

function handleEscape() {
  if (dateEditMode) {
    toggleDateEdit();
  } else if (currentPopup !== null) {
    currentPopup.remove();
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    handleEscape();
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (handleArrowNav(e.key)) e.preventDefault();
    return;
  }
  if (e.key === ' ') {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (currentSinglePhotoIndex !== null) {
      e.preventDefault();
      document.dispatchEvent(new ShowLightboxEvent(currentSinglePhotoIndex));
    }
  }
}

const popupActions: PopupActions = {
  copyLocation: () => {
    copyLocationFromPopup();
  },
  pasteLocation: () => {
    pasteLocation();
  },
  copyDate: () => {
    copyDateFromPopup();
  },
  pasteDate: () => {
    pasteDateToPhoto();
  },
  toggleDateEdit: () => {
    toggleDateEdit();
  },
  adjustTime: (hours) => {
    const uuid = getCurrentPhotoUuid();
    if (uuid !== null) adjustTime(uuid, hours);
  },
  applyManualDate: (value) => {
    applyManualDate(value);
  }
};

export function initPopupCallbacks(
  m: MapGL,
  highlight: (photo: Photo | null) => void,
  panToFitPopup: (coords: [number, number]) => void,
  getMarkerRadius: (zoom: number) => number
) {
  map = m;
  highlightFn = highlight;
  panToFitPopupFn = panToFitPopup;
  getMarkerRadiusFn = getMarkerRadius;
  initPopupZoom(m, getSelectedMarkerCoords);
  m.on('zoomend', reanchorPopup);

  document.addEventListener('keydown', handleKeydown);
}

export function getCurrentPopup(): Popup | null {
  return currentPopup;
}

export function getCurrentPhotoUuid(): string | null {
  return currentPhotoUuid;
}

export function reopenPopupFromUrl() {
  const uuid = photoFromUrl();
  if (uuid === null) return;
  const index = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
  if (index === -1) return;
  showPopup(index);
}

function getCurrentPhoto(): Photo | undefined {
  if (currentSinglePhotoIndex !== null) {
    return state.filteredPhotos[currentSinglePhotoIndex];
  }
  return undefined;
}

function computePasteState(photo: Photo): {
  showPasteLocation: boolean;
  showPasteDate: boolean;
} {
  let showPasteLocation = false;
  const copiedLoc = getCopiedLocation();
  if (copiedLoc !== null) {
    const loc = getEffectiveLocation(photo);
    showPasteLocation = copiedLoc.lat !== loc?.lat || copiedLoc.lon !== loc.lon;
  }
  let showPasteDate = false;
  const copiedDate = getCopiedDate();
  if (copiedDate !== null) {
    const effectiveDate = getEffectiveDate(photo);
    showPasteDate = effectiveDate !== '' && effectiveDate !== copiedDate;
  }
  return { showPasteLocation, showPasteDate };
}

function createPopupElement(photo: Photo, index: number): PhotoPopup {
  const el = document.createElement('photo-popup') as PhotoPopup;
  el.photo = photo;
  el.index = index;
  el.dateEditMode = dateEditMode;
  el.actions = popupActions;
  const paste = computePasteState(photo);
  el.showPasteLocation = paste.showPasteLocation;
  el.showPasteDate = paste.showPasteDate;
  return el;
}

function refreshPopupElement() {
  if (currentPopupElement === null || currentSinglePhotoIndex === null) return;
  const photo = state.filteredPhotos[currentSinglePhotoIndex];
  if (photo === undefined) return;
  currentPopupElement.photo = photo;
  currentPopupElement.index = currentSinglePhotoIndex;
  currentPopupElement.dateEditMode = dateEditMode;
  const paste = computePasteState(photo);
  currentPopupElement.showPasteLocation = paste.showPasteLocation;
  currentPopupElement.showPasteDate = paste.showPasteDate;
  currentPopupElement.requestUpdate();
}

export function showPopup(index: number) {
  if (currentPopup !== null) {
    currentPopup.remove();
  }

  if (map === null) return;

  const photo = state.filteredPhotos[index];
  if (photo === undefined) return;

  const { lon, lat } = getEffectiveCoords(photo);

  dateEditMode = false;
  currentSinglePhotoIndex = index;
  currentPhotoUuid = photo.uuid;
  highlightFn(photo);
  photoToUrl(photo.uuid);

  currentPopupElement = createPopupElement(photo, index);

  currentPopup = new Popup({
    closeButton: false,
    maxWidth: '320px',
    anchor: 'bottom',
    offset: popupOffset(),
    subpixelPositioning: true
  })
    .setLngLat([lon, lat])
    .setDOMContent(currentPopupElement)
    .addTo(map);

  setupPopupEvents(currentPopup.getElement());
  installCanvasZoomOverride();

  currentPopup.on('close', () => {
    if (reanchoring) return;
    removeCanvasZoomOverride();
    dateEditMode = false;
    highlightFn(null);
    currentSinglePhotoIndex = null;
    currentPhotoUuid = null;
    currentPopupElement = null;
    photoToUrl(null);
  });

  panToFitPopupFn([lon, lat]);
}

function adjustTime(uuid: string, hours: number) {
  addPendingTimeEdit(uuid, hours);
  refreshPopupElement();
}

function copyLocationFromPopup() {
  const photo = getCurrentPhoto();
  if (photo === undefined) return;
  const loc = getEffectiveLocation(photo);
  if (loc === null) return;
  copyLocation(loc.lat, loc.lon);
  refreshPopupElement();
}

function pasteLocation() {
  if (currentSinglePhotoIndex === null) return;
  const photo = state.filteredPhotos[currentSinglePhotoIndex];
  const copied = getCopiedLocation();
  if (photo === undefined || copied === null) return;

  addPendingEdit(photo.uuid, copied.lat, copied.lon);
  showPopup(currentSinglePhotoIndex);
}

function copyDateFromPopup() {
  const photo = getCurrentPhoto();
  if (photo === undefined) return;
  const effectiveDate = getEffectiveDate(photo);
  if (effectiveDate === '') return;
  copyDate(effectiveDate);
  refreshPopupElement();
}

function pasteDateToPhoto() {
  const photo = getCurrentPhoto();
  if (photo === undefined) return;
  const copied = getCopiedDate();
  if (copied === null) return;
  const copiedDate = parseExifDate(copied);
  if (copiedDate === null) return;
  const offset = computeFullDatetimeOffsetHours(photo.date, copiedDate);
  if (offset === null) return;
  setPendingTimeEdit(photo.uuid, offset);
  refreshPopupElement();
}

function toggleDateEdit() {
  dateEditMode = !dateEditMode;
  refreshPopupElement();
}

function applyManualDate(dateValue: string) {
  const photo = getCurrentPhoto();
  if (photo === undefined) return;
  if (dateValue.trim() === '') return;
  const yearStr = photo.date.split(':')[0];
  const fallbackYear =
    yearStr !== undefined && yearStr !== ''
      ? parseInt(yearStr, 10)
      : new Date().getFullYear();
  const parsed = parseUserDatetime(dateValue, fallbackYear);
  if (parsed === null) return;
  const offset = computeManualDateOffset(photo.date, parsed);
  if (offset === null) return;
  setPendingTimeEdit(photo.uuid, offset);
  dateEditMode = false;
  refreshPopupElement();
}

export function navigateSinglePhoto(newIndex: number) {
  const photo = state.filteredPhotos[newIndex];
  if (photo === undefined || currentPopup === null) return;

  dateEditMode = false;
  currentSinglePhotoIndex = newIndex;
  currentPhotoUuid = photo.uuid;
  highlightFn(photo);
  photoToUrl(photo.uuid);

  refreshPopupElement();

  const loc = getEffectiveLocation(photo);
  const lng = loc?.lon ?? 0;
  const lat = loc?.lat ?? 0;
  currentPopup.setLngLat([lng, lat]);
  panToFitPopupFn([lng, lat]);
}
