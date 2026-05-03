import { Popup } from 'maplibre-gl';
import type { Map as MapGL } from 'maplibre-gl';

import * as actions from '@common/actions';
import { getCopiedDate, getCopiedLocation } from '@common/clipboard';
import * as edits from '@common/edits';
import { effect } from '@common/signals';
import type { Photo } from '@common/types';
import { getThumbUrl } from '@common/utils';
import { viewState } from '@common/view-state';
import type { PhotoPopup, PopupActions } from '@components/photo-popup';

import markers from '../markers';
import selection from '../selection';
import * as popupEdits from './edits';
import { flyToPopupTo, panToFitPopup } from './pan';
import {
  initPopupZoom,
  installCanvasZoomOverride,
  removeCanvasZoomOverride,
  setupPopupEvents
} from './zoom';

let popup: Popup | null = null;
let popupElement: PhotoPopup | null = null;
let mountedUuid: string | null = null;
// Set during forceRemount so the 'close' handler skips its
// external-teardown selection clear.
let suppressCloseClear = false;

let map: MapGL | null = null;

function popupOffset(): [number, number] {
  const z = map?.getZoom() ?? 10;
  const radius = markers.getRadius(z);
  return [0, -(radius * 1.3 + 5)];
}

function getSelectedMarkerCoords(): [number, number] | null {
  const photo = selection.getPhoto();
  if (photo === undefined) return null;
  const { lon, lat } = edits.getEffectiveCoords(photo);
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

function handleEscape() {
  if (popupEdits.getDateEditMode()) {
    popupEdits.toggleDateEdit();
  } else if (selection.isPopupOpen()) {
    selection.closePopup();
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    handleEscape();
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const moved = e.key === 'ArrowLeft' ? selection.prev() : selection.next();
    if (moved) e.preventDefault();
    return;
  }
  if (e.key === ' ') {
    const idx = selection.getPhotoIndex();
    if (idx !== null) {
      e.preventDefault();
      actions.showLightbox(idx);
    }
  }
}

const popupActions: PopupActions = {
  confirmLocation: popupEdits.confirmCurrentLocation,
  copyLocation: popupEdits.copyCurrentLocation,
  pasteLocation: popupEdits.pasteCurrentLocation,
  copyDate: popupEdits.copyCurrentDate,
  pasteDate: popupEdits.pasteCurrentDate,
  toggleDateEdit: popupEdits.toggleDateEdit,
  adjustTime: popupEdits.adjustCurrentTime,
  applyManualDate: popupEdits.applyManualDateToCurrent
};

function init(m: MapGL) {
  map = m;
  initPopupZoom(m, getSelectedMarkerCoords);
  m.on('zoomend', reanchorPopup);
  m.on('render', updatePopupGlobeMask);

  document.addEventListener('keydown', handleKeydown);

  // Defer so markers' effect swaps the layer first; getRadius() then
  // returns the new style's radius.
  let lastMarkerStyle = viewState.markerStyle.get();
  effect(() => {
    const next = viewState.markerStyle.get();
    if (next === lastMarkerStyle) return;
    lastMarkerStyle = next;
    queueMicrotask(reanchorPopup);
  });

  // Must precede applySelection's effect so the date-edit reset fires
  // first and the popup's Lit re-sync sees the fresh value.
  popupEdits.initPopupEdits();
  effect(() => {
    edits.pendingCoords.get();
    edits.pendingTimeOffsets.get();
    selection.selectedPhotoUuid.get();
    selection.interactionMode.get();
    applySelection();
  });
  popupEdits.subscribe(applySelection);
}

function applySelection() {
  if (!selection.isPopupOpen()) {
    if (popup !== null) popup.remove();
    return;
  }
  const uuid = selection.selectedPhotoUuid.get();
  if (uuid === null) return;

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

  const { lon, lat } = edits.getEffectiveCoords(photo);
  const idx = selection.getPhotoIndex() ?? 0;

  mountedUuid = photo.uuid;
  popupElement = createPopupElement(photo, idx);

  popup = new Popup({
    closeButton: false,
    closeOnClick: false,
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
    popup = null;
    popupElement = null;
    mountedUuid = null;
    if (!suppressCloseClear && selection.isPopupOpen()) {
      // Closed via MapLibre's own teardown (e.g. setStyle); keep state in sync.
      selection.closePopup();
    }
  });

  panToFitPopup(map, popup);
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
  if (popup === null || map === null) return;
  const photo = selection.getPhoto();
  if (photo?.uuid !== photoUuid) return;

  const idx = selection.getPhotoIndex() ?? 0;
  const loc = edits.getEffectiveLocation(photo);
  const lng = loc?.lon ?? 0;
  const lat = loc?.lat ?? 0;

  mountedUuid = photo.uuid;
  syncPopupElement(photo, idx);
  popup.setLngLat([lng, lat]);
  flyToPopupTo(map, popup, [lng, lat]);
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
  const { lon, lat } = edits.getEffectiveCoords(photo);
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

function get(): Popup | null {
  return popup;
}

// Force a full unmount/remount; the same-uuid path otherwise just syncs
// in place, leaving the popup anchored to the old projection.
function forceRemount(): void {
  if (popup === null) return;
  suppressCloseClear = true;
  popup.remove();
  suppressCloseClear = false;
  applySelection();
}

function computePasteVisibility(photo: Photo): {
  showPasteLocation: boolean;
  showPasteDate: boolean;
} {
  let showPasteLocation = false;
  const copiedLoc = getCopiedLocation();
  if (copiedLoc !== null) {
    const loc = edits.getEffectiveLocation(photo);
    showPasteLocation = copiedLoc.lat !== loc?.lat || copiedLoc.lon !== loc.lon;
  }
  let showPasteDate = false;
  const copiedDate = getCopiedDate();
  if (copiedDate !== null) {
    const effectiveDate = edits.getEffectiveDate(photo);
    showPasteDate = effectiveDate !== '' && effectiveDate !== copiedDate;
  }
  return { showPasteLocation, showPasteDate };
}

function createPopupElement(photo: Photo, index: number): PhotoPopup {
  const el = document.createElement('photo-popup') as PhotoPopup;
  el.photo = photo;
  el.index = index;
  el.dateEditMode = popupEdits.getDateEditMode();
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
  popupElement.dateEditMode = popupEdits.getDateEditMode();
  const paste = computePasteVisibility(p);
  popupElement.showPasteLocation = paste.showPasteLocation;
  popupElement.showPasteDate = paste.showPasteDate;
  popupElement.requestUpdate();
}

export default { init, get, forceRemount };
