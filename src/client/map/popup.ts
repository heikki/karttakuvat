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
import { SaveEditsEvent, ShowLightboxEvent } from '@common/events';
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
import type { PhotoPopup, PopupActions } from '@components/photo-popup';

import {
  initPopupZoom,
  installCanvasZoomOverride,
  removeCanvasZoomOverride,
  setupPopupEvents
} from './popup-zoom';

// State
let popup: Popup | null = null;
let popupElement: PhotoPopup | null = null;
let popupPhotoIndex: number | null = null;
let photoUuid: string | null = null;
let dateEditMode = false;

// Callbacks that will be set by map.ts
let highlightFn: (photo: Photo | null) => void = () => {
  /* noop */
};
let panToFitPopupFn: (coords: [number, number]) => void = () => {
  /* noop */
};
let flyToPopupFn: (coords: [number, number]) => void = () => {
  /* noop */
};
let map: MapGL | null = null;
let getMarkerRadiusFn: (zoom: number) => number = () => 0;
function popupOffset(): [number, number] {
  const zoom = map?.getZoom() ?? 10;
  const radius = getMarkerRadiusFn(zoom);
  return [0, -(radius * 1.3 + 5)];
}

function getSelectedMarkerCoords(): [number, number] | null {
  const photo = getPhoto();
  if (photo === undefined) return null;
  const { lon, lat } = getEffectiveCoords(photo);
  return [lon, lat];
}

function reanchorPopup() {
  if (popup === null) return;
  if (!popup.isOpen()) return;
  // Just update the offset — no remove/addTo cycle.
  // Removing and re-adding the popup during a zoomend handler causes
  // re-entrant rendering (ResizeObserver → redraw → TaskQueue crash).
  popup.setOffset(popupOffset());
}

function handleArrowNav(key: string) {
  if (popupPhotoIndex === null) return false;
  const total = state.filteredPhotos.length;
  const newIdx =
    (popupPhotoIndex + (key === 'ArrowLeft' ? -1 : 1) + total) % total;
  navigateToPhoto(newIdx);
  return true;
}

function handleEscape() {
  if (dateEditMode) {
    toggleDateEdit();
  } else if (popup !== null) {
    popup.remove();
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
    if (popupPhotoIndex !== null) {
      e.preventDefault();
      document.dispatchEvent(new ShowLightboxEvent(popupPhotoIndex));
    }
  }
}

const popupActions: PopupActions = {
  confirmLocation: () => {
    confirmLocation();
  },
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
    const uuid = getPhotoUuid();
    if (uuid !== null) adjustTime(uuid, hours);
  },
  applyManualDate: (value) => {
    applyManualDate(value);
  }
};

interface PopupCallbacks {
  highlight: (photo: Photo | null) => void;
  panToFitPopup: (coords: [number, number]) => void;
  flyToPopup: (coords: [number, number]) => void;
  getMarkerRadius: (zoom: number) => number;
}

export function initPopupCallbacks(m: MapGL, callbacks: PopupCallbacks) {
  map = m;
  highlightFn = callbacks.highlight;
  panToFitPopupFn = callbacks.panToFitPopup;
  flyToPopupFn = callbacks.flyToPopup;
  getMarkerRadiusFn = callbacks.getMarkerRadius;
  initPopupZoom(m, getSelectedMarkerCoords);
  m.on('zoomend', reanchorPopup);
  m.on('render', updatePopupGlobeMask);

  document.addEventListener('keydown', handleKeydown);
}

function updatePopupGlobeMask() {
  if (popup === null || map === null) return;
  const el = popup.getElement();
  if (!el) return;

  if (map.getProjection().type !== 'globe') {
    el.style.maskImage = '';
    return;
  }

  const lngLat = popup.getLngLat();
  const occluded = lngLat ? map.transform.isLocationOccluded(lngLat) : false;

  if (!occluded) {
    el.style.maskImage = '';
    return;
  }

  // Globe is always centered in the map container
  const container = map.getContainer();
  const globeCx = container.clientWidth / 2;
  const globeCy = container.clientHeight / 2;

  // Compute screen-space globe silhouette radius.
  // In 3D: sphere of radius R at distance D from camera.
  // Visual silhouette radius on screen = focalLength * R / sqrt(D² - R²)
  const t = map.transform as any;
  const R: number =
    t.worldSize / (2.0 * Math.PI) / Math.cos(map.getCenter().lat * Math.PI / 180);
  const f: number = t.cameraToCenterDistance; // focal length in pixels
  const D = f + R; // camera-to-sphere-center distance
  const r = f * R / Math.sqrt(D * D - R * R);

  // clip-path operates in pre-transform space, but the popup is moved via CSS
  // transform. Compensate by subtracting the visual offset from globe coords.
  const mapRect = container.getBoundingClientRect();
  const popupRect = el.getBoundingClientRect();
  const cx = globeCx - (popupRect.left - mapRect.left);
  const cy = globeCy - (popupRect.top - mapRect.top);

  // Use a radial-gradient mask: transparent inside globe, opaque outside.
  // The gradient is centered in its own box; mask-position offsets it so the
  // gradient center lands at (cx, cy) in the element's coordinate space.
  const maskSize = Math.max(container.clientWidth, container.clientHeight) * 3;
  const half = maskSize / 2;
  el.style.maskImage =
    `radial-gradient(circle ${r}px at center, transparent ${r}px, black ${r}px)`;
  el.style.maskSize = `${maskSize}px ${maskSize}px`;
  el.style.maskPosition = `${cx - half}px ${cy - half}px`;
  el.style.maskRepeat = 'no-repeat';
}

export function getPopup(): Popup | null {
  return popup;
}

export function getPhotoUuid(): string | null {
  return photoUuid;
}

export function reopenPopupFromUrl() {
  const uuid = photoFromUrl();
  if (uuid === null) return;
  const index = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
  if (index === -1) return;
  showPopup(index);
}

function getPhoto(): Photo | undefined {
  if (popupPhotoIndex !== null) {
    return state.filteredPhotos[popupPhotoIndex];
  }
  return undefined;
}

function computePasteVisibility(photo: Photo): {
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
  const paste = computePasteVisibility(photo);
  el.showPasteLocation = paste.showPasteLocation;
  el.showPasteDate = paste.showPasteDate;
  return el;
}

function syncPopupElement() {
  if (popupElement === null || popupPhotoIndex === null) return;
  const photo = state.filteredPhotos[popupPhotoIndex];
  if (photo === undefined) return;
  popupElement.photo = photo;
  popupElement.index = popupPhotoIndex;
  popupElement.dateEditMode = dateEditMode;
  const paste = computePasteVisibility(photo);
  popupElement.showPasteLocation = paste.showPasteLocation;
  popupElement.showPasteDate = paste.showPasteDate;
  popupElement.requestUpdate();
}

export function showPopup(index: number) {
  if (popup !== null) {
    popup.remove();
  }

  if (map === null) return;

  const photo = state.filteredPhotos[index];
  if (photo === undefined) return;

  const { lon, lat } = getEffectiveCoords(photo);

  dateEditMode = false;
  popupPhotoIndex = index;
  photoUuid = photo.uuid;
  highlightFn(photo);
  photoToUrl(photo.uuid);

  popupElement = createPopupElement(photo, index);

  popup = new Popup({
    closeButton: false,
    maxWidth: '320px',
    anchor: 'bottom',
    offset: popupOffset(),
    subpixelPositioning: true
  })
    .setLngLat([lon, lat])
    .setDOMContent(popupElement)
    .addTo(map);

  setupPopupEvents(popup.getElement());
  installCanvasZoomOverride();

  popup.on('close', () => {
    removeCanvasZoomOverride();
    dateEditMode = false;
    highlightFn(null);
    popupPhotoIndex = null;
    photoUuid = null;
    popupElement = null;
    photoToUrl(null);
  });

  panToFitPopupFn([lon, lat]);
}

function adjustTime(uuid: string, hours: number) {
  addPendingTimeEdit(uuid, hours);
  syncPopupElement();
}

function confirmLocation() {
  const photo = getPhoto();
  if (photo === undefined) return;
  const loc = getEffectiveLocation(photo);
  if (loc === null) return;
  addPendingEdit(photo.uuid, loc.lat, loc.lon);
  document.dispatchEvent(new SaveEditsEvent());
}

function copyLocationFromPopup() {
  const photo = getPhoto();
  if (photo === undefined) return;
  const loc = getEffectiveLocation(photo);
  if (loc === null) return;
  copyLocation(loc.lat, loc.lon);
}

function pasteLocation() {
  if (popupPhotoIndex === null) return;
  const photo = state.filteredPhotos[popupPhotoIndex];
  const copied = getCopiedLocation();
  if (photo === undefined || copied === null) return;

  addPendingEdit(photo.uuid, copied.lat, copied.lon);
  showPopup(popupPhotoIndex);
}

function copyDateFromPopup() {
  const photo = getPhoto();
  if (photo === undefined) return;
  const effectiveDate = getEffectiveDate(photo);
  if (effectiveDate === '') return;
  copyDate(effectiveDate);
}

function pasteDateToPhoto() {
  const photo = getPhoto();
  if (photo === undefined) return;
  const copied = getCopiedDate();
  if (copied === null) return;
  const copiedDate = parseExifDate(copied);
  if (copiedDate === null) return;
  const offset = computeFullDatetimeOffsetHours(photo.date, copiedDate);
  if (offset === null) return;
  setPendingTimeEdit(photo.uuid, offset);
  syncPopupElement();
}

function toggleDateEdit() {
  dateEditMode = !dateEditMode;
  syncPopupElement();
}

function applyManualDate(dateValue: string) {
  const photo = getPhoto();
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
  syncPopupElement();
}

function navigateToPhoto(newIndex: number) {
  const photo = state.filteredPhotos[newIndex];
  if (photo === undefined || popup === null) return;

  dateEditMode = false;
  popupPhotoIndex = newIndex;
  photoUuid = photo.uuid;
  highlightFn(photo);
  photoToUrl(photo.uuid);

  syncPopupElement();

  const loc = getEffectiveLocation(photo);
  const lng = loc?.lon ?? 0;
  const lat = loc?.lat ?? 0;
  popup.setLngLat([lng, lat]);
  flyToPopupFn([lng, lat]);
}
