import './components';

import {
  clearPendingEdits,
  loadPhotos,
  state,
  subscribe
} from '@common/data';
import {
  AdjustTimeEvent,
  ApplyManualDateEvent,
  CopyDateEvent,
  CopyLocationEvent,
  EnterPlacementEvent,
  PasteDateEvent,
  PasteLocationEvent,
  ShowLightboxEvent,
  ShowMetadataEvent,
  ToggleDateEditEvent
} from '@common/events';
import { photoFromUrl, photoToUrl } from '@common/filter-url';
import { getEffectiveLocation } from '@common/photo-utils';
import { initGpx, loadGpxForAlbum, setGpxVisible } from './map/gpx';
import {
  changeMapStyle,
  changeMarkerStyle,
  enterPlacementMode,
  fitToPhotos,
  getMap,
  initMap
} from './map';
import {
  exitMeasureMode,
  isMeasureMode,
  toggleMeasureMode
} from './map/measure';
import { initKeyboard } from './keyboard';
import { reopenPopup, saveEdits } from './save';
import type { FilterPanel } from '@components/filter-panel';
import type { MetadataModal } from '@components/metadata-modal';
import type { PhotoLightbox } from '@components/photo-lightbox';
import {
  adjustTime,
  applyManualDate,
  copyDateFromPopup,
  copyLocationFromPopup,
  getCurrentPhotoUuid,
  getCurrentPopup,
  pasteDateToPhoto,
  pasteLocation,
  setOnPhotoChange,
  toggleDateEdit
} from './map/popup';

function getLightbox(): PhotoLightbox {
  return document.getElementById('lightbox') as unknown as PhotoLightbox;
}

function getFilterPanel(): FilterPanel {
  return document.getElementById('filter-panel') as unknown as FilterPanel;
}

function getMapContext() {
  const map = getMap();
  const c = map.getCenter();
  const z = Math.round(map.getZoom());
  const uuid = getCurrentPhotoUuid();
  if (uuid === null) return { c, z, loc: undefined };
  const photo = state.filteredPhotos.find((p) => p.uuid === uuid);
  if (photo === undefined) return { c, z, loc: undefined };
  return { c, z, loc: getEffectiveLocation(photo) ?? undefined };
}

// Wire custom events from Lit components
document.addEventListener(ShowLightboxEvent.type, (e: Event) => {
  getLightbox().show((e as ShowLightboxEvent).index);
});
document.addEventListener(EnterPlacementEvent.type, (e: Event) => {
  enterPlacementMode((e as EnterPlacementEvent).index);
});
document.addEventListener(CopyLocationEvent.type, () => {
  copyLocationFromPopup();
});
document.addEventListener(PasteLocationEvent.type, () => {
  pasteLocation();
});
document.addEventListener(AdjustTimeEvent.type, (e: Event) => {
  const evt = e as AdjustTimeEvent;
  const uuid = getCurrentPhotoUuid();
  if (uuid !== null) adjustTime(uuid, evt.hours);
});
document.addEventListener(CopyDateEvent.type, () => {
  copyDateFromPopup();
});
document.addEventListener(PasteDateEvent.type, () => {
  pasteDateToPhoto();
});
document.addEventListener(ToggleDateEditEvent.type, () => {
  toggleDateEdit();
});
document.addEventListener(ApplyManualDateEvent.type, (e: Event) => {
  applyManualDate((e as ApplyManualDateEvent).dateValue);
});
document.addEventListener(ShowMetadataEvent.type, (e: Event) => {
  const modal = document.getElementById('metadata-modal') as unknown as MetadataModal;
  modal.loadMetadata((e as ShowMetadataEvent).uuid);
});

// Filter panel events
document.addEventListener('map-style-change', (e: Event) => {
  changeMapStyle((e as CustomEvent).detail as string);
});
document.addEventListener('marker-style-change', (e: Event) => {
  changeMarkerStyle((e as CustomEvent).detail as string);
});
document.addEventListener('fit-view', () => {
  fitToPhotos(true, true);
});
document.addEventListener('reset-app', () => {
  getCurrentPopup()?.remove();
  if (isMeasureMode()) exitMeasureMode();
  changeMapStyle('satellite');
  fitToPhotos(true);
});
document.addEventListener('toggle-measure', () => {
  toggleMeasureMode();
});
document.addEventListener('toggle-tracks', (e: Event) => {
  setGpxVisible((e as CustomEvent).detail as boolean);
});
document.addEventListener('open-apple-maps', () => {
  const { c, z, loc } = getMapContext();
  const url =
    loc === undefined
      ? `maps://?ll=${c.lat},${c.lng}&z=${z}&t=k`
      : `maps://?ll=${loc.lat},${loc.lon}&q=${loc.lat},${loc.lon}&z=${z}&t=k`;
  window.open(url, '_blank');
});
document.addEventListener('open-google-maps', () => {
  const { c, z, loc } = getMapContext();
  const url =
    loc === undefined
      ? `https://www.google.com/maps/@${c.lat},${c.lng},${z}z`
      : `https://www.google.com/maps?q=${loc.lat},${loc.lon}&z=${z}`;
  window.open(url, '_blank');
});
document.addEventListener('save-edits', () => {
  void saveEdits();
});
document.addEventListener('discard-edits', () => {
  clearPendingEdits();
});

// Prevent zoom gestures
document.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false }
);
const prevent = (e: Event) => {
  e.preventDefault();
};
document.addEventListener('gesturestart', prevent);
document.addEventListener('gesturechange', prevent);

// Init
document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    await loadPhotos();
    initMap();
    initGpx(getMap());
    initKeyboard();
    setOnPhotoChange(photoToUrl);
    getFilterPanel().applyInitialFilters();
    reopenPopup(photoFromUrl());
  })();
});

subscribe(() => {
  void loadGpxForAlbum(
    state.filters.album === 'all' ? null : state.filters.album
  );
});
