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
import {
  ChangeMarkerStyleEvent,
  PlacementModeEvent,
  SaveEditsEvent,
  ShowLightboxEvent
} from '@common/events';
import {
  computeManualDateOffset,
  getEffectiveDate,
  getEffectiveLocation
} from '@common/photo-utils';
import type { Photo } from '@common/types';
import {
  computeFullDatetimeOffsetHours,
  getThumbUrl,
  parseExifDate,
  parseUserDatetime
} from '@common/utils';
import type { PhotoPopup, PopupActions } from '@components/photo-popup';

import { getMarkerRadius } from './markers';
import { createFlyToPopup, createPanToFitPopup } from './pan';
import {
  initPopupZoom,
  installCanvasZoomOverride,
  removeCanvasZoomOverride,
  setupPopupEvents
} from './popup-zoom';
import * as selection from './selection';

let popup: Popup | null = null;
let popupElement: PhotoPopup | null = null;
let mountedUuid: string | null = null;
let dateEditMode = false;

let map: MapGL | null = null;
let panToFitPopup: (coords: [number, number]) => void = () => {
  /* set in initPopup */
};
let flyToPopup: (coords: [number, number]) => void = () => {
  /* set in initPopup */
};

function popupOffset(): [number, number] {
  const zoom = map?.getZoom() ?? 10;
  const radius = getMarkerRadius(zoom);
  return [0, -(radius * 1.3 + 5)];
}

function getSelectedMarkerCoords(): [number, number] | null {
  const photo = selection.getPhoto();
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

function handleArrowNav(key: string): boolean {
  const idx = selection.getPhotoIndex();
  if (idx === null) return false;
  const total = state.filteredPhotos.length;
  if (total === 0) return false;
  const newIdx = (idx + (key === 'ArrowLeft' ? -1 : 1) + total) % total;
  const next = state.filteredPhotos[newIdx];
  if (next === undefined) return false;
  selection.openPopup(next.uuid);
  return true;
}

function handleEscape() {
  if (dateEditMode) {
    toggleDateEdit();
  } else if (selection.getMode() === 'popup') {
    selection.clear();
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
    const idx = selection.getPhotoIndex();
    if (idx !== null) {
      e.preventDefault();
      document.dispatchEvent(new ShowLightboxEvent(idx));
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
    const uuid = selection.getPhotoUuid();
    if (uuid !== null) adjustTime(uuid, hours);
  },
  applyManualDate: (value) => {
    applyManualDate(value);
  }
};

export function initPopup(m: MapGL) {
  map = m;
  panToFitPopup = createPanToFitPopup(m);
  flyToPopup = createFlyToPopup(m);
  initPopupZoom(m, getSelectedMarkerCoords);
  m.on('zoomend', reanchorPopup);
  m.on('render', updatePopupGlobeMask);

  document.addEventListener('keydown', handleKeydown);

  // Bare request signal from <photo-popup>'s "set" button: enter placement
  // mode for the currently-selected photo.
  document.addEventListener(PlacementModeEvent.type, () => {
    const uuid = selection.getPhotoUuid();
    if (uuid !== null) selection.enterPlacement(uuid);
  });

  // Marker style swap changes the radius scheme. This listener is registered
  // before markers' (popup is init'd before markers), so we defer to a
  // microtask — markers' synchronous listener swaps the layer, then our
  // microtask runs reanchorPopup with the new radius.
  document.addEventListener(ChangeMarkerStyleEvent.type, () => {
    queueMicrotask(reanchorPopup);
  });

  selection.subscribe(applySelection);
}

function applySelection() {
  const mode = selection.getMode();
  const uuid = selection.getPhotoUuid();

  if (mode !== 'popup' || uuid === null) {
    if (popup !== null) popup.remove();
    return;
  }

  if (mountedUuid === uuid && popup !== null) {
    // Same photo selected, just sync (e.g. pending edit moved its position).
    syncPopupPositionAndContent();
    return;
  }

  if (mountedUuid !== null && popup !== null) {
    // Different photo — navigate (smooth fly) instead of full recreate.
    void navigateToCurrent();
    return;
  }

  mountCurrent();
}

function mountCurrent() {
  if (map === null) return;
  const photo = selection.getPhoto();
  if (photo === undefined) return;

  const { lon, lat } = getEffectiveCoords(photo);
  const idx = selection.getPhotoIndex() ?? 0;

  dateEditMode = false;
  mountedUuid = photo.uuid;
  popupElement = createPopupElement(photo, idx);

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

  // If we mounted before the map's first 'load' (URL-restoration race),
  // markers haven't installed yet → getMarkerRadius returned 0 → offset is
  // wrong. Registered here (after initMarkers' load handler), so it fires
  // second and corrects the offset.
  if (!map.loaded()) {
    void map.once('load', () => {
      if (popup !== null) popup.setOffset(popupOffset());
    });
  }

  popup.on('close', () => {
    removeCanvasZoomOverride();
    dateEditMode = false;
    popup = null;
    popupElement = null;
    mountedUuid = null;
    if (selection.getMode() === 'popup') {
      // Closed via MapLibre's own teardown (e.g. setStyle); keep state in sync.
      selection.clear();
    }
  });

  panToFitPopup([lon, lat]);
}

let navSeq = 0;

async function preloadThumb(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    /* fall through; nav proceeds with whatever the browser shows */
  }
}

function applyNavigation(photoUuid: string): void {
  if (popup === null) return;
  const photo = selection.getPhoto();
  if (photo?.uuid !== photoUuid) return;

  const idx = selection.getPhotoIndex() ?? 0;
  const loc = getEffectiveLocation(photo);
  const lng = loc?.lon ?? 0;
  const lat = loc?.lat ?? 0;

  dateEditMode = false;
  mountedUuid = photo.uuid;
  syncPopupElement(photo, idx);
  popup.setLngLat([lng, lat]);
  flyToPopup([lng, lat]);
}

async function navigateToCurrent(): Promise<void> {
  const seq = ++navSeq;
  const photo = selection.getPhoto();
  if (photo === undefined) return;

  // Preload the new thumb (no DOM swap yet) so that when we replace the img
  // and move the popup, the browser paints both in the same frame — no
  // intermediate jitter from a half-loaded image resizing the popup.
  await preloadThumb(getThumbUrl(photo));
  if (seq !== navSeq) return;
  applyNavigation(photo.uuid);
}

function syncPopupPositionAndContent() {
  if (popup === null) return;
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const idx = selection.getPhotoIndex() ?? 0;
  const { lon, lat } = getEffectiveCoords(photo);
  syncPopupElement(photo, idx);
  popup.setLngLat([lon, lat]);
}

function updatePopupGlobeMask() {
  if (popup === null || map === null) return;
  const el = popup.getElement() as HTMLElement | undefined;
  if (el === undefined) return;

  if (map.getProjection().type !== 'globe') {
    el.style.maskImage = '';
    return;
  }

  const lngLat = popup.getLngLat();
  const occluded = map.transform.isLocationOccluded(lngLat);

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
  const t = map.transform as {
    worldSize: number;
    cameraToCenterDistance: number;
  };
  const R: number =
    t.worldSize /
    (2.0 * Math.PI) /
    Math.cos((map.getCenter().lat * Math.PI) / 180);
  const f: number = t.cameraToCenterDistance; // focal length in pixels
  const D = f + R; // camera-to-sphere-center distance
  const r = (f * R) / Math.sqrt(D * D - R * R);

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
  el.style.maskImage = `radial-gradient(circle ${r}px at center, transparent ${r}px, black ${r}px)`;
  el.style.maskSize = `${maskSize}px ${maskSize}px`;
  el.style.maskPosition = `${cx - half}px ${cy - half}px`;
  el.style.maskRepeat = 'no-repeat';
}

export function getPopup(): Popup | null {
  return popup;
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

function syncPopupElement(photo?: Photo, index?: number) {
  if (popupElement === null) return;
  const p = photo ?? selection.getPhoto();
  if (p === undefined) return;
  const i = index ?? selection.getPhotoIndex() ?? 0;
  popupElement.photo = p;
  popupElement.index = i;
  popupElement.dateEditMode = dateEditMode;
  const paste = computePasteVisibility(p);
  popupElement.showPasteLocation = paste.showPasteLocation;
  popupElement.showPasteDate = paste.showPasteDate;
  popupElement.requestUpdate();
}

function adjustTime(uuid: string, hours: number) {
  addPendingTimeEdit(uuid, hours);
  syncPopupElement();
}

function confirmLocation() {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const loc = getEffectiveLocation(photo);
  if (loc === null) return;
  addPendingEdit(photo.uuid, loc.lat, loc.lon);
  document.dispatchEvent(new SaveEditsEvent());
}

function copyLocationFromPopup() {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const loc = getEffectiveLocation(photo);
  if (loc === null) return;
  copyLocation(loc.lat, loc.lon);
}

function pasteLocation() {
  const photo = selection.getPhoto();
  const copied = getCopiedLocation();
  if (photo === undefined || copied === null) return;
  addPendingEdit(photo.uuid, copied.lat, copied.lon);
}

function copyDateFromPopup() {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const effectiveDate = getEffectiveDate(photo);
  if (effectiveDate === '') return;
  copyDate(effectiveDate);
}

function pasteDateToPhoto() {
  const photo = selection.getPhoto();
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
  const photo = selection.getPhoto();
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
