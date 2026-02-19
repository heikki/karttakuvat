import './components';

import {
  clearPendingEdits,
  getPendingEdits,
  getPendingTimeEdits,
  loadPhotos,
  state,
  subscribe
} from './lib/data';
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
} from './lib/events';
import { photoFromUrl, photoToUrl } from './lib/filter-url';
import { initGpx, loadGpxForAlbum, setGpxVisible } from './lib/gpx';
import {
  changeMapStyle,
  changeMarkerStyle,
  enterPlacementMode,
  fitToPhotos,
  getMap,
  initMap
} from './lib/map';
import {
  exitMeasureMode,
  isMeasureMode,
  toggleMeasureMode
} from './lib/measure';
import type { FilterPanel } from './components/filter-panel';
import type { MetadataModal } from './components/metadata-modal';
import type { PhotoLightbox } from './components/photo-lightbox';
import {
  adjustTime,
  applyManualDate,
  copyDateFromPopup,
  copyLocationFromPopup,
  getCurrentPhotoUuid,
  getCurrentPopup,
  getCurrentSinglePhotoIndex,
  isDateEditMode,
  navigateSinglePhoto,
  pasteDateToPhoto,
  pasteLocation,
  setOnPhotoChange,
  showPopup,
  toggleDateEdit
} from './lib/popup';
import { getEffectiveLocation } from './lib/popup/utils';

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

// Keyboard handlers
function handleArrowNav(e: KeyboardEvent) {
  if (getLightbox().isActive) return false;
  if (getCurrentSinglePhotoIndex() === null) return false;
  e.preventDefault();
  const total = state.filteredPhotos.length;
  const idx = getCurrentSinglePhotoIndex()!;
  const newIdx = (idx + (e.key === 'ArrowLeft' ? -1 : 1) + total) % total;
  navigateSinglePhoto(newIdx);
  return true;
}

function handleSpaceKey(e: KeyboardEvent) {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  if (getLightbox().isActive) {
    e.preventDefault();
    e.stopPropagation();
    getLightbox().hide();
    return;
  }
  const idx = getCurrentSinglePhotoIndex();
  if (idx !== null) {
    e.preventDefault();
    e.stopPropagation();
    getLightbox().show(idx);
  }
}

document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape') {
      if (isDateEditMode()) {
        e.preventDefault();
        toggleDateEdit();
      } else if (getCurrentPopup() !== null) {
        e.preventDefault();
        getCurrentPopup()?.remove();
      }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      handleArrowNav(e);
      return;
    }
    if (e.key === ' ') {
      handleSpaceKey(e);
    }
  },
  true
);

getLightbox().setNavigateCallback((index) => {
  navigateSinglePhoto(index);
});

function reopenPopup(uuid: string | null) {
  if (uuid === null) return;
  const newIndex = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
  if (newIndex === -1) return;
  const photo = state.filteredPhotos[newIndex]!;
  showPopup({ index: newIndex }, [photo.lon ?? 0, photo.lat ?? 0]);
}

async function saveEdits() {
  const panel = getFilterPanel();
  const edits = getPendingEdits();
  const timeEdits = getPendingTimeEdits();
  if (edits.length === 0 && timeEdits.length === 0) return;

  panel.saving = true;

  try {
    const response = await fetch('/api/save-edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edits, timeEdits })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    const reopenUuid = getCurrentPhotoUuid();
    getCurrentPopup()?.remove();
    await loadPhotos();
    clearPendingEdits();
    reopenPopup(reopenUuid);
  } catch (err) {
    console.error('Failed to save edits:', err);
    // eslint-disable-next-line no-alert -- user needs feedback on save failure
    alert(
      `Failed to save edits: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    panel.saving = false;
  }
}

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
    initGpx(getMap);
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
