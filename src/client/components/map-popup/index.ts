import { customElement } from 'lit/decorators.js';
import { Popup } from 'maplibre-gl';

import * as actions from '@common/actions';
import * as edits from '@common/edits';
import selection from '@common/selection';
import { effect } from '@common/signals';
import type { Photo } from '@common/types';
import {
  computeDateOffsetHours,
  computeFullDatetimeOffsetHours,
  getThumbUrl,
  parseExifDate,
  parseUserDatetime
} from '@common/utils';
import { viewState } from '@common/view-state';
import { MapFeatureElement } from '@components/map-view/api';
import type { PhotoPopup, PopupActions } from '@components/photo-popup';

import { applyGlobeMask } from './globe-mask';
import { flyToPopupTo, panToFitPopup } from './pan';

const WHEEL_ZOOM_RATE = 1 / 300;

// Module-level copy buffers for the popup's location and date edits.
// Plain refs — clipboard sync isn't needed; these only persist within
// the running app session.
let copiedLocation: { lat: number; lon: number } | null = null;
let copiedDate: string | null = null;

function copyLocation(lat: number, lon: number) {
  copiedLocation = { lat, lon };
}

function getCopiedLocation(): { lat: number; lon: number } | null {
  return copiedLocation;
}

function copyDate(datePart: string) {
  copiedDate = datePart;
}

function getCopiedDate(): string | null {
  return copiedDate;
}

// Popup-action helpers wired into the PopupActions surface below. All
// stateless; date-edit-mode lives on <map-popup> itself.

function confirmCurrentLocation(): void {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const loc = edits.getEffectiveLocation(photo);
  if (loc === null) return;
  edits.setCoord(photo.uuid, loc.lat, loc.lon);
  actions.saveEdits();
}

function copyCurrentLocation(): void {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const loc = edits.getEffectiveLocation(photo);
  if (loc === null) return;
  copyLocation(loc.lat, loc.lon);
}

function pasteCurrentLocation(): void {
  const photo = selection.getPhoto();
  const copied = getCopiedLocation();
  if (photo === undefined || copied === null) return;
  edits.setCoord(photo.uuid, copied.lat, copied.lon);
}

function copyCurrentDate(): void {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const effectiveDate = edits.getEffectiveDate(photo);
  if (effectiveDate === '') return;
  copyDate(effectiveDate);
}

function pasteCurrentDate(): void {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const copied = getCopiedDate();
  if (copied === null) return;
  const parsed = parseExifDate(copied);
  if (parsed === null) return;
  const offset = computeFullDatetimeOffsetHours(photo.date, parsed);
  if (offset === null) return;
  edits.setTimeOffset(photo.uuid, offset);
}

function adjustCurrentTime(hours: number): void {
  const uuid = selection.selectedPhotoUuid.get();
  if (uuid === null) return;
  edits.addTimeOffset(uuid, hours);
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

function getSelectedMarkerCoords(): [number, number] | null {
  const photo = selection.getPhoto();
  if (photo === undefined) return null;
  const { lon, lat } = edits.getEffectiveCoords(photo);
  return [lon, lat];
}

function computeManualDateOffset(
  originalDate: string,
  parsed: { day: string; time: string | null }
): number | null {
  if (parsed.time === null) {
    return computeDateOffsetHours(originalDate, parsed.day);
  }
  const timeParts = parsed.time.split(':').map(Number);
  const dayParts = parsed.day.split(':');
  const target = new Date(
    parseInt(dayParts[0]!, 10),
    parseInt(dayParts[1]!, 10) - 1,
    parseInt(dayParts[2]!, 10),
    timeParts[0] ?? 0,
    timeParts[1] ?? 0,
    timeParts[2] ?? 0
  );
  return computeFullDatetimeOffsetHours(originalDate, target);
}

@customElement('map-popup')
export class MapPopup extends MapFeatureElement {
  // The three move in lockstep: set together in mountCurrent, cleared
  // together on close. Bundling them makes the invariant explicit.
  private mounted: {
    popup: Popup;
    el: PhotoPopup;
    uuid: string;
  } | null = null;
  // Set during forceRemount so the 'close' handler skips its
  // external-teardown selection clear.
  private suppressCloseClear = false;
  private navSeq = 0;
  // Cache key for the last-applied globe-mask state — skip the four
  // style writes per render when nothing observable changed.
  private lastMaskKey = '';
  private dateEditMode = false;
  // Tracks the last selected uuid for the date-edit-reset effect: when
  // selection moves to a different photo while date-edit is on, the mode
  // should auto-clear so the new popup renders read-only by default.
  private lastSelectedUuid: string | null = null;
  // Custom-wheel-zoom state: while a popup is open, scroll-zoom on either
  // the popup or the canvas anchors at the selected marker (instead of the
  // cursor) so the marker stays under the mouse. Mouse drags on the popup
  // are forwarded to the canvas so the user can pan through it.
  private canvasWheelHandler: ((e: WheelEvent) => void) | null = null;
  private attachedPopupEl: HTMLElement | null = null;
  private popupMouseHandlers: Array<{
    type: string;
    handler: (e: MouseEvent) => void;
  }> = [];
  private readonly popupActions: PopupActions = {
    confirmLocation: confirmCurrentLocation,
    copyLocation: copyCurrentLocation,
    pasteLocation: pasteCurrentLocation,
    copyDate: copyCurrentDate,
    pasteDate: pasteCurrentDate,
    toggleDateEdit: () => {
      this.dateEditMode = !this.dateEditMode;
      this.applySelection();
    },
    adjustTime: adjustCurrentTime,
    applyManualDate: (value: string) => {
      this.applyManualDate(value);
    }
  };

  override firstUpdated() {
    this.api.map.on('zoomend', () => {
      this.reanchorPopup();
    });
    this.api.map.on('render', () => {
      this.updatePopupGlobeMask();
    });

    document.addEventListener('keydown', (e) => {
      this.handleKeydown(e);
    });

    // Defer so markers' effect swaps the layer first; getRadius() then
    // returns the new style's radius.
    let lastMarkerStyle = viewState.markerStyle.get();
    effect(() => {
      const next = viewState.markerStyle.get();
      if (next === lastMarkerStyle) return;
      lastMarkerStyle = next;
      queueMicrotask(() => {
        this.reanchorPopup();
      });
    });

    // Must precede applySelection's effect so the date-edit reset fires
    // first and the popup's Lit re-sync sees the fresh value.
    effect(() => {
      const uuid = selection.selectedPhotoUuid.get();
      const popupOpen = selection.isPopupOpen();
      if (this.dateEditMode && (!popupOpen || uuid !== this.lastSelectedUuid)) {
        this.dateEditMode = false;
      }
      this.lastSelectedUuid = uuid;
    });
    effect(() => {
      edits.pendingCoords.get();
      edits.pendingTimeOffsets.get();
      selection.selectedPhotoUuid.get();
      selection.interactionMode.get();
      this.applySelection();
    });
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.dateEditMode) {
        this.dateEditMode = false;
        this.applySelection();
      } else if (selection.isPopupOpen()) {
        selection.closePopup();
      }
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

  private applyManualDate(value: string): void {
    const photo = selection.getPhoto();
    if (photo === undefined) return;
    if (value.trim() === '') return;
    const yearStr = photo.date.split(':')[0];
    const fallbackYear =
      yearStr !== undefined && yearStr !== ''
        ? parseInt(yearStr, 10)
        : new Date().getFullYear();
    const parsed = parseUserDatetime(value, fallbackYear);
    if (parsed === null) return;
    const offset = computeManualDateOffset(photo.date, parsed);
    if (offset === null) return;
    // Must precede setTimeOffset — its signal write triggers a popup re-sync
    // that reads dateEditMode.
    this.dateEditMode = false;
    edits.setTimeOffset(photo.uuid, offset);
  }

  private createPopupElement(photo: Photo, index: number): PhotoPopup {
    const el = document.createElement('photo-popup') as PhotoPopup;
    el.photo = photo;
    el.index = index;
    el.dateEditMode = this.dateEditMode;
    el.actions = this.popupActions;
    const paste = computePasteVisibility(photo);
    el.showPasteLocation = paste.showPasteLocation;
    el.showPasteDate = paste.showPasteDate;
    return el;
  }

  /** Current MapLibre Popup, if any. */
  get(): Popup | null {
    return this.mounted?.popup ?? null;
  }

  /**
   * Force a full unmount/remount; the same-uuid path otherwise just syncs
   * in place, leaving the popup anchored to the old projection.
   */
  forceRemount(): void {
    if (this.mounted === null) return;
    this.suppressCloseClear = true;
    this.mounted.popup.remove();
    this.suppressCloseClear = false;
    this.applySelection();
  }

  private popupOffset(): [number, number] {
    const z = this.api.map.getZoom();
    const radius = this.api.markerRadius(z);
    return [0, -(radius * 1.3 + 5)];
  }

  private reanchorPopup(): void {
    if (this.mounted === null) return;
    if (!this.mounted.popup.isOpen()) return;
    // Just update the offset — no remove/addTo cycle.
    // Removing and re-adding the popup during a zoomend handler causes
    // re-entrant rendering (ResizeObserver → redraw → TaskQueue crash).
    this.mounted.popup.setOffset(this.popupOffset());
  }

  private applySelection(): void {
    if (!selection.isPopupOpen()) {
      this.mounted?.popup.remove();
      return;
    }
    const uuid = selection.selectedPhotoUuid.get();
    if (uuid === null) return;

    if (this.mounted === null) {
      this.mountCurrent();
      return;
    }

    if (this.mounted.uuid === uuid) {
      // Same photo selected, just sync (e.g. pending edit moved its position).
      this.syncPopupPositionAndContent();
      return;
    }

    // Different photo — navigate (smooth fly) instead of full recreate.
    void this.navigateToCurrent();
  }

  private mountCurrent(): void {
    const photo = selection.getPhoto();
    if (photo === undefined) return;

    const { lon, lat } = edits.getEffectiveCoords(photo);
    const idx = selection.getPhotoIndex() ?? 0;

    const el = this.createPopupElement(photo, idx);
    const popup = new Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: '320px',
      anchor: 'bottom',
      offset: this.popupOffset(),
      subpixelPositioning: true
    })
      .setLngLat([lon, lat])
      .setDOMContent(el)
      .addTo(this.api.map);

    this.mounted = { popup, el, uuid: photo.uuid };

    this.setupPopupEvents(popup.getElement());
    this.installCanvasZoomOverride();

    popup.on('close', () => {
      this.removeCanvasZoomOverride();
      this.mounted = null;
      this.lastMaskKey = '';
      if (!this.suppressCloseClear && selection.isPopupOpen()) {
        // Closed via MapLibre's own teardown (e.g. setStyle); keep state in sync.
        selection.closePopup();
      }
    });

    panToFitPopup(this.api.map, popup);
  }

  private async navigateToCurrent(): Promise<void> {
    const seq = ++this.navSeq;
    const photo = selection.getPhoto();
    if (photo === undefined) return;

    // Preload the new thumb (no DOM swap yet) so that when we replace the img
    // and move the popup, the browser paints both in the same frame — no
    // intermediate jitter from a half-loaded image resizing the popup.
    const img = new Image();
    img.src = getThumbUrl(photo);
    try {
      await img.decode();
    } catch {
      /* fall through; nav proceeds with whatever the browser shows */
    }
    if (seq !== this.navSeq) return;
    this.applyNavigation(photo.uuid);
  }

  private applyNavigation(photoUuid: string): void {
    if (this.mounted === null) return;
    const photo = selection.getPhoto();
    if (photo?.uuid !== photoUuid) return;

    const idx = selection.getPhotoIndex() ?? 0;
    const loc = edits.getEffectiveLocation(photo);
    const lng = loc?.lon ?? 0;
    const lat = loc?.lat ?? 0;

    this.mounted.uuid = photo.uuid;
    this.syncPopupElement(photo, idx);
    this.mounted.popup.setLngLat([lng, lat]);
    flyToPopupTo(this.api.map, this.mounted.popup, [lng, lat]);
  }

  private syncPopupPositionAndContent(): void {
    if (this.mounted === null) return;
    const photo = selection.getPhoto();
    if (photo === undefined) return;
    const idx = selection.getPhotoIndex() ?? 0;
    const { lon, lat } = edits.getEffectiveCoords(photo);
    this.syncPopupElement(photo, idx);
    this.mounted.popup.setLngLat([lon, lat]);
  }

  private syncPopupElement(photo: Photo, index: number): void {
    if (this.mounted === null) return;
    const { el } = this.mounted;
    el.photo = photo;
    el.index = index;
    el.dateEditMode = this.dateEditMode;
    const paste = computePasteVisibility(photo);
    el.showPasteLocation = paste.showPasteLocation;
    el.showPasteDate = paste.showPasteDate;
    el.requestUpdate();
  }

  // Bound to the map's `render` event so the mask follows projection
  // transitions (which fire `render` continuously between start/end).
  // Cheap on idle frames thanks to the cache key in applyGlobeMask.
  private updatePopupGlobeMask(): void {
    if (this.mounted === null) return;
    this.lastMaskKey = applyGlobeMask(
      this.api.map,
      this.mounted.popup,
      this.lastMaskKey
    );
  }

  private readonly zoomAroundPopup = (e: WheelEvent): void => {
    const map = this.api.map;
    const coords = getSelectedMarkerCoords();
    if (coords === null) return;
    e.preventDefault();
    e.stopPropagation();
    const oldZoom = map.getZoom();
    const delta = -e.deltaY * WHEEL_ZOOM_RATE;
    const newZoom = Math.max(
      map.getMinZoom(),
      Math.min(map.getMaxZoom(), oldZoom + delta)
    );
    if (newZoom === oldZoom) return;
    const anchorPx = map.project(coords);
    const { clientWidth: w, clientHeight: h } = map.getCanvas();

    // If the marker is off-screen, zoom around cursor position instead.
    const markerOnScreen =
      anchorPx.x >= 0 && anchorPx.x <= w && anchorPx.y >= 0 && anchorPx.y <= h;
    const rect = map.getCanvas().getBoundingClientRect();
    const zoomAnchor = markerOnScreen
      ? anchorPx
      : { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const scale = 2 ** (newZoom - oldZoom);
    const newCenterPx = [
      zoomAnchor.x + (w / 2 - zoomAnchor.x) / scale,
      zoomAnchor.y + (h / 2 - zoomAnchor.y) / scale
    ] as [number, number];
    map.jumpTo({ center: map.unproject(newCenterPx), zoom: newZoom });
  };

  private setupPopupEvents(popupEl: HTMLElement): void {
    this.removePopupEvents();
    const canvas = this.api.map.getCanvas();
    this.attachedPopupEl = popupEl;
    popupEl.addEventListener('wheel', this.zoomAroundPopup);
    for (const type of ['mousedown', 'mousemove', 'mouseup'] as const) {
      const handler = (e: MouseEvent): void => {
        e.preventDefault();
        canvas.dispatchEvent(new MouseEvent(type, e));
      };
      popupEl.addEventListener(type, handler);
      this.popupMouseHandlers.push({ type, handler });
    }
  }

  private removePopupEvents(): void {
    if (this.attachedPopupEl === null) return;
    this.attachedPopupEl.removeEventListener('wheel', this.zoomAroundPopup);
    for (const { type, handler } of this.popupMouseHandlers) {
      this.attachedPopupEl.removeEventListener(type, handler as EventListener);
    }
    this.popupMouseHandlers = [];
    this.attachedPopupEl = null;
  }

  private installCanvasZoomOverride(): void {
    const map = this.api.map;
    map.scrollZoom.disable();
    this.canvasWheelHandler = this.zoomAroundPopup;
    map.getCanvas().addEventListener('wheel', this.canvasWheelHandler);
  }

  private removeCanvasZoomOverride(): void {
    const map = this.api.map;
    if (this.canvasWheelHandler !== null) {
      map.getCanvas().removeEventListener('wheel', this.canvasWheelHandler);
      this.canvasWheelHandler = null;
    }
    map.scrollZoom.enable();
    this.removePopupEvents();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-popup': MapPopup;
  }
}
