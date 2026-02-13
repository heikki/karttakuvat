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
  changeMapStyle,
  enterPlacementMode,
  fitToPhotos,
  initMap,
  selectGroupPhoto
} from './lib/map';
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
  showPopup,
  toggleDateEdit
} from './lib/popup';
import {
  hideLightbox,
  initUI,
  isLightboxActive,
  populateAlbumFilter,
  populateCameraFilter,
  populateYearFilter,
  setLightboxNavigateCallback,
  showGroupLightbox,
  showLightbox,
  updatePendingEdits,
  updateStats
} from './lib/ui';
import { getYear } from './lib/utils';

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
  }
}

// Note: map.ts might need to call updateLightboxGroup.
// Ideally map.ts is updated to import updateLightboxGroup and call it in showMultiPhotoPopup.
// I will just monkey-patch it here or update map.ts in next step if needed.
// BUT WAIT: map.ts logic is already written.
// map.ts generates HTML onclick="window.showGroupLightbox(0)".
// map.ts has `clusterPhotos` local variable.
// ui.ts has `currentGroupPhotos` local variable.
// I need to sync them.
// I should have updated map.ts to call `updateLightboxGroup` when creating the popup.
// I cannot easily edit map.ts again inside this thought block.
// Alternative: `window.showGroupLightbox` wrapper in index.ts that pulls from map?
// No, map does not expose `clusterPhotos`.

// Correct fix: Update `map.ts` to export `getClusterPhotos`.
// Then in `index.ts`:
// (window as any).showGroupLightbox = (index) => {
//    updateLightboxGroup(getClusterPhotos());
//    showGroupLightbox(index);
// }

// Let's modify map.ts to export getClusterPhotos.
// Actually, I can just update map.ts one more time quickly.
// OR: I can assume that `selectGroupPhoto` in map.ts (called by thumbnail click)
// can be hooked?
// `selectGroupPhoto` is exported.
// But `showGroupLightbox` acts on `currentPopup`.

// Let's assume for now that I need to update map.ts to call updateLightboxGroup.
// Im already 10 tool calls deep in this turn? No.
// I'll update map.ts next.

// For now write index.ts assuming exports exist.

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

// Expose global functions for HTML access
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

function setupFilterListeners() {
  const yearSelect = document.getElementById('year-select');
  const albumSelect = document.getElementById('album-select');
  const cameraSelect = document.getElementById('camera-select');
  const mediaButtons = document.getElementById('media-buttons');
  const gpsButtons = document.getElementById('gps-buttons');

  const handleFilterChange = () => {
    const y = (yearSelect as HTMLSelectElement | null)?.value ?? 'all';
    const a = (albumSelect as HTMLSelectElement | null)?.value ?? 'all';
    const c = (cameraSelect as HTMLSelectElement | null)?.value ?? 'all';
    const m = Array.from(
      document.querySelectorAll('#media-buttons .filter-btn.active')
    ).map((btn) => (btn as HTMLElement).dataset.value!);
    const g = Array.from(
      document.querySelectorAll('#gps-buttons .filter-btn.active')
    ).map((btn) => (btn as HTMLElement).dataset.value!);
    applyFilters({ year: y, gps: g, media: m, album: a, camera: c });
  };

  for (const el of [yearSelect, albumSelect, cameraSelect]) {
    el?.addEventListener('change', handleFilterChange);
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
        handleFilterChange();
      }, 250);
    });
    container?.addEventListener('dblclick', (e) => {
      if (clickTimer !== null) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.filter-btn');
      if (btn === null) return;
      for (const b of Array.from(container.querySelectorAll('.filter-btn'))) {
        b.classList.toggle('active', b === btn);
      }
      handleFilterChange();
    });
  }
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

    // Reopen popup on the same photo
    if (reopenUuid !== null) {
      const newIndex = state.filteredPhotos.findIndex(
        (p) => p.uuid === reopenUuid
      );
      if (newIndex !== -1) {
        const photo = state.filteredPhotos[newIndex]!;
        showPopup({ index: newIndex }, [photo.lon, photo.lat]);
      }
    }
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

document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    initUI();

    // Event Listeners
    const mapButtons = document.getElementById('map-type-buttons');
    if (mapButtons !== null) {
      mapButtons.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>(
          '.map-type-btn'
        );
        if (btn === null) return;
        const style = btn.dataset.style;
        if (style === undefined) return;
        mapButtons
          .querySelector('.map-type-btn.active')
          ?.classList.remove('active');
        btn.classList.add('active');
        changeMapStyle(style);
      });
    }

    setupFilterListeners();

    // Fit to view button
    const fitViewBtn = document.getElementById('fit-view-btn');
    if (fitViewBtn !== null) {
      fitViewBtn.addEventListener('click', () => {
        fitToPhotos(true, true);
      });
    }

    // Save/Discard edits
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

    // Load data
    await loadPhotos();

    // Init Map
    initMap();

    // Populate UI
    const years = [
      ...new Set(
        state.photos.map(getYear).filter((y): y is string => y !== null)
      )
    ].sort();
    populateYearFilter(years);

    const albums = [...new Set(state.photos.flatMap((p) => p.albums))].sort();
    populateAlbumFilter(albums);

    const cameras = [
      ...new Set(
        state.photos.map((p) => p.camera ?? '(unknown)')
      )
    ].sort();
    populateCameraFilter(cameras);

    updateStats(state.filteredPhotos);
  })();
});

subscribe((filtered) => {
  updateStats(filtered);
});

subscribeEdits((count) => {
  updatePendingEdits(count);
});
