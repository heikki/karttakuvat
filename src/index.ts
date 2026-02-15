import {
  applyFilters,
  clearPendingEdits,
  copyLocation,
  getPendingEdits,
  getPendingTimeEdits,
  loadPhotos,
  state,
  subscribe,
  subscribeEdits
} from './lib/data';
import {
  filtersFromUrl,
  filtersToUrl,
  initStyleButtonGroup,
  mapStyleFromUrl,
  mapStyleToUrl,
  markerStyleFromUrl,
  markerStyleToUrl,
  photoFromUrl,
  photoToUrl,
  setButtonGroupActive,
  setSelectValue
} from './lib/filter-url';
import {
  changeMapStyle,
  changeMarkerStyle,
  enterPlacementMode,
  fitToPhotos,
  getMap,
  initMap,
  selectGroupPhoto
} from './lib/map';
import {
  exitMeasureMode,
  isMeasureMode,
  toggleMeasureMode
} from './lib/measure';
import { initMetadataModal, showMetadata } from './lib/metadata';
import { resetNightLayer } from './lib/night';
import {
  adjustTime,
  applyManualDate,
  copyDateFromPopup,
  copyLocationFromPopup,
  getClusterPhotos,
  getCurrentGroupIndex,
  getCurrentPhotoUuid,
  getCurrentPopup,
  getCurrentSinglePhotoIndex,
  handleDateInputKey,
  isDateEditMode,
  navigateSinglePhoto,
  pasteDateToPhoto,
  pasteLocation,
  setOnPhotoChange,
  showPopup,
  toggleDateEdit
} from './lib/popup';
import { getEffectiveLocation } from './lib/popup-html';
import { clearSelection } from './lib/selection';
import {
  hideLightbox,
  initUI,
  isLightboxActive,
  repopulateSelect,
  setLightboxNavigateCallback,
  showGroupLightbox,
  showLightbox,
  updatePendingEdits,
  updateStats
} from './lib/ui';
import { getYear } from './lib/utils';

function getSelectedPhotoLocation(): { lat: number; lon: number } | undefined {
  const uuid = getCurrentPhotoUuid();
  if (uuid === null) return undefined;
  const photo = state.filteredPhotos.find((p) => p.uuid === uuid);
  if (photo === undefined) return undefined;
  return getEffectiveLocation(photo) ?? undefined;
}

declare global {
  interface Window {
    selectGroupPhoto: typeof selectGroupPhoto;
    showLightbox: typeof showLightbox;
    showGroupLightbox: typeof showGroupLightbox;
    enterPlacementMode: typeof enterPlacementMode;
    copyLocation: typeof copyLocation;
    copyLocationFromPopup: typeof copyLocationFromPopup;
    adjustTime: typeof adjustTime;
    pasteLocation: typeof pasteLocation;
    copyDateFromPopup: typeof copyDateFromPopup;
    pasteDateToPhoto: typeof pasteDateToPhoto;
    toggleDateEdit: typeof toggleDateEdit;
    applyManualDate: typeof applyManualDate;
    handleDateInputKey: typeof handleDateInputKey;
    showMetadata: (uuid: string) => void;
  }
}

// Keyboard shortcuts (capture phase to intercept before focused elements)
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && isDateEditMode()) {
      e.preventDefault();
      toggleDateEdit();
      return;
    }
    if (e.key !== ' ') return;
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (isLightboxActive()) {
      e.preventDefault();
      e.stopPropagation();
      hideLightbox();
      return;
    }
    const cluster = getClusterPhotos();
    if (cluster.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      showGroupLightbox(getCurrentGroupIndex());
      return;
    }
    const idx = getCurrentSinglePhotoIndex();
    if (idx !== null) {
      e.preventDefault();
      e.stopPropagation();
      showLightbox(idx);
    }
  },
  true
);

// Sync lightbox navigation to map marker selection
setLightboxNavigateCallback((mode, index) => {
  if (mode === 'group') {
    selectGroupPhoto(index);
  } else {
    navigateSinglePhoto(index);
  }
});

window.selectGroupPhoto = selectGroupPhoto;
window.showLightbox = showLightbox;
window.showGroupLightbox = showGroupLightbox;
window.enterPlacementMode = enterPlacementMode;
window.copyLocation = copyLocation;
window.copyLocationFromPopup = copyLocationFromPopup;
window.adjustTime = adjustTime;
window.pasteLocation = pasteLocation;
window.copyDateFromPopup = copyDateFromPopup;
window.pasteDateToPhoto = pasteDateToPhoto;
window.toggleDateEdit = toggleDateEdit;
window.applyManualDate = applyManualDate;
window.handleDateInputKey = handleDateInputKey;
window.showMetadata = showMetadata;

function restoreFiltersFromUrl() {
  const saved = filtersFromUrl();
  if (saved === null) {
    cascadeAndApply();
    return;
  }
  if (saved.year !== undefined) setSelectValue('year-select', saved.year);
  if (saved.gps !== undefined) setButtonGroupActive('gps-buttons', saved.gps);
  if (saved.media !== undefined) {
    setButtonGroupActive('media-buttons', saved.media);
  }
  // Album/camera need cascading — set year first, cascade, then set values
  cascadeAndApply();
  if (saved.album !== undefined) {
    setSelectValue('album-select', saved.album);
    cascadeAndApply();
  }
  if (saved.camera !== undefined) {
    setSelectValue('camera-select', saved.camera);
    cascadeAndApply();
  }
}

function cascadeAndApply() {
  const y =
    (document.getElementById('year-select') as HTMLSelectElement | null)
      ?.value ?? 'all';

  // Cascade: Year → Album options
  const yearPhotos =
    y === 'all' ? state.photos : state.photos.filter((p) => getYear(p) === y);
  repopulateSelect(
    'album-select',
    [...new Set(yearPhotos.flatMap((p) => p.albums))].sort()
  );
  const a =
    (document.getElementById('album-select') as HTMLSelectElement | null)
      ?.value ?? 'all';

  // Cascade: Year + Album → Camera options
  const albumPhotos =
    a === 'all' ? yearPhotos : yearPhotos.filter((p) => p.albums.includes(a));
  repopulateSelect(
    'camera-select',
    [...new Set(albumPhotos.map((p) => p.camera ?? '(unknown)'))].sort()
  );
  const c =
    (document.getElementById('camera-select') as HTMLSelectElement | null)
      ?.value ?? 'all';

  const m = Array.from(
    document.querySelectorAll('#media-buttons .filter-btn.active')
  ).map((btn) => (btn as HTMLElement).dataset.value!);
  const g = Array.from(
    document.querySelectorAll('#gps-buttons .filter-btn.active')
  ).map((btn) => (btn as HTMLElement).dataset.value!);
  applyFilters({ year: y, gps: g, media: m, album: a, camera: c });
  filtersToUrl({ year: y, album: a, camera: c, gps: g, media: m });
}

function setupFilterListeners() {
  const statsPanel = document.getElementById('stats-panel')!;
  const panelHeader = document.getElementById('panel-header')!;
  panelHeader.addEventListener('click', () => {
    statsPanel.classList.toggle('collapsed');
  });

  const yearSelect = document.getElementById('year-select');
  const albumSelect = document.getElementById('album-select');
  const cameraSelect = document.getElementById('camera-select');
  const mediaButtons = document.getElementById('media-buttons');
  const gpsButtons = document.getElementById('gps-buttons');

  for (const el of [yearSelect, albumSelect, cameraSelect]) {
    el?.addEventListener('change', cascadeAndApply);
  }

  for (const container of [mediaButtons, gpsButtons]) {
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    container?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.filter-btn');
      if (btn === null) return;
      if (clickTimer !== null) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        btn.classList.toggle('active');
        cascadeAndApply();
      }, 250);
    });
    container?.addEventListener('dblclick', (e) => {
      if (clickTimer !== null) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.filter-btn');
      if (btn === null) return;
      const allBtns = Array.from(container.querySelectorAll('.filter-btn'));
      const activeBtns = allBtns.filter((b) => b.classList.contains('active'));
      const isOnlyActive =
        activeBtns.length === 1 && activeBtns[0] === btn;
      for (const b of allBtns) {
        b.classList.toggle('active', isOnlyActive || b === btn);
      }
      cascadeAndApply();
    });
  }
}


function reopenPopup(uuid: string | null) {
  if (uuid === null) return;
  const newIndex = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
  if (newIndex === -1) return;
  const photo = state.filteredPhotos[newIndex]!;
  showPopup({ index: newIndex }, [photo.lon ?? 0, photo.lat ?? 0]);
}

async function saveEdits() {
  const btn = document.getElementById('save-edits-btn');
  if (btn === null) return;
  const edits = getPendingEdits();
  const timeEdits = getPendingTimeEdits();
  if (edits.length === 0 && timeEdits.length === 0) return;

  btn.setAttribute('disabled', '');
  btn.textContent = 'Saving...';

  try {
    const response = await fetch('/api/set-locations', {
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
    btn.removeAttribute('disabled');
    btn.textContent = 'Save to Photos';
  }
}

function handleReset() {
  getCurrentPopup()?.remove();
  clearSelection();
  if (isMeasureMode()) exitMeasureMode();
  resetNightLayer(getMap());
  setSelectValue('year-select', 'all');
  setButtonGroupActive('gps-buttons', ['exif', 'inferred', 'user', 'none']);
  setButtonGroupActive('media-buttons', ['photo', 'video']);
  const albums = [...new Set(state.photos.flatMap((p) => p.albums))].sort();
  const cameras = [
    ...new Set(state.photos.map((p) => p.camera ?? '(unknown)'))
  ].sort();
  repopulateSelect('album-select', albums);
  repopulateSelect('camera-select', cameras);
  setSelectValue('album-select', 'all');
  setSelectValue('camera-select', 'all');
  applyFilters({
    year: 'all',
    gps: ['exif', 'inferred', 'user', 'none'],
    media: ['photo', 'video'],
    album: 'all',
    camera: 'all'
  });
  filtersToUrl({
    year: 'all',
    album: 'all',
    camera: 'all',
    gps: ['exif', 'inferred', 'user', 'none'],
    media: ['photo', 'video']
  });
  history.replaceState(null, '', location.pathname);
  const mapButtons = document.getElementById('map-type-buttons');
  const currentStyle = mapButtons?.querySelector('.map-type-btn.active')?.getAttribute('data-style');
  if (currentStyle !== 'satellite') {
    changeMapStyle('satellite');
    mapButtons?.querySelector('.map-type-btn.active')?.classList.remove('active');
    mapButtons
      ?.querySelector('.map-type-btn[data-style="satellite"]')
      ?.classList.add('active');
  }
  fitToPhotos(true);
}

// Prevent accidental page zoom from trackpad pinch gestures
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => { e.preventDefault(); });
document.addEventListener('gesturechange', (e) => { e.preventDefault(); });

document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    initUI();
    initMetadataModal();

    setupFilterListeners();

    const fitViewBtn = document.getElementById('fit-view-btn');
    if (fitViewBtn !== null) {
      fitViewBtn.addEventListener('click', () => {
        fitToPhotos(true, true);
      });
    }

    const appleMapsBtn = document.getElementById('apple-maps-btn');
    if (appleMapsBtn !== null) {
      appleMapsBtn.addEventListener('click', () => {
        const map = getMap();
        const center = map.getCenter();
        const zoom = Math.round(map.getZoom());
        const loc = getSelectedPhotoLocation();
        const url =
          loc === undefined
            ? `maps://?ll=${center.lat},${center.lng}&z=${zoom}&t=k`
            : `maps://?ll=${loc.lat},${loc.lon}&q=${loc.lat},${loc.lon}&z=${zoom}&t=k`;
        window.open(url, '_blank');
      });
    }

    const googleMapsBtn = document.getElementById('google-maps-btn');
    if (googleMapsBtn !== null) {
      googleMapsBtn.addEventListener('click', () => {
        const map = getMap();
        const center = map.getCenter();
        const zoom = Math.round(map.getZoom());
        const loc = getSelectedPhotoLocation();
        const url =
          loc === undefined
            ? `https://www.google.com/maps/@${center.lat},${center.lng},${zoom}z`
            : `https://www.google.com/maps?q=${loc.lat},${loc.lon}&z=${zoom}`;
        window.open(url, '_blank');
      });
    }

    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn !== null) {
      resetBtn.addEventListener('click', handleReset);
    }

    const measureBtn = document.getElementById('measure-btn');
    if (measureBtn !== null) {
      measureBtn.addEventListener('click', () => {
        toggleMeasureMode();
        measureBtn.classList.toggle('active', isMeasureMode());
      });
    }

    const saveBtn = document.getElementById('save-edits-btn');
    const discardBtn = document.getElementById('discard-edits-btn');

    if (saveBtn !== null) {
      saveBtn.addEventListener('click', () => {
        void saveEdits();
      });
    }

    if (discardBtn !== null) {
      discardBtn.addEventListener('click', () => {
        clearPendingEdits();
      });
    }

    await loadPhotos();
    initMap();

    initStyleButtonGroup(
      'map-type-buttons',
      (s) => { changeMapStyle(s); mapStyleToUrl(s); },
      mapStyleFromUrl
    );
    initStyleButtonGroup(
      'marker-style-buttons',
      (s) => { changeMarkerStyle(s); markerStyleToUrl(s); },
      markerStyleFromUrl
    );

    const years = [
      ...new Set(
        state.photos.map(getYear).filter((y): y is string => y !== null)
      )
    ].sort();
    repopulateSelect('year-select', years);

    setOnPhotoChange(photoToUrl);
    restoreFiltersFromUrl();
    reopenPopup(photoFromUrl());

    updateStats(state.filteredPhotos);
  })();
});

subscribe((filtered) => {
  updateStats(filtered);
});

subscribeEdits((count) => {
  updatePendingEdits(count);
});
