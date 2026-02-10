import { loadConfig } from './lib/config';
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
import { adjustTime } from './lib/popup';
import {
  browseAllPhotos,
  initUI,
  populateAlbumFilter,
  populateYearFilter,
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
    adjustTime: typeof adjustTime;
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

// Expose global functions for HTML access
window.selectGroupPhoto = selectGroupPhoto;
window.showLightbox = showLightbox;
window.showGroupLightbox = showGroupLightbox;
window.enterPlacementMode = enterPlacementMode;
window.copyLocation = copyLocation;
window.adjustTime = adjustTime;

function setupFilterListeners() {
  const yearSelect = document.getElementById('year-select');
  const gpsSelect = document.getElementById('gps-select');
  const mediaSelect = document.getElementById('media-select');
  const albumSelect = document.getElementById('album-select');

  const handleFilterChange = () => {
    if (yearSelect === null || gpsSelect === null || mediaSelect === null || albumSelect === null) {
      return;
    }
    const y = (yearSelect as HTMLSelectElement).value;
    const g = (gpsSelect as HTMLSelectElement).value;
    const m = (mediaSelect as HTMLSelectElement).value;
    const a = (albumSelect as HTMLSelectElement).value;
    applyFilters(y, g, m, a);
  };

  for (const el of [yearSelect, gpsSelect, mediaSelect, albumSelect]) {
    el?.addEventListener('change', handleFilterChange);
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
    await loadPhotos();
    clearPendingEdits();
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
    const mapSelect = document.getElementById('map-select');
    if (mapSelect !== null) {
      mapSelect.addEventListener('change', (e) => {
        changeMapStyle((e.target as HTMLSelectElement).value);
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

    // Stats interactions
    const countEl = document.getElementById('photo-count');
    const countLabel = countEl?.nextElementSibling as HTMLElement | null;
    if (countEl !== null) {
      countEl.addEventListener('click', browseAllPhotos);
      countEl.style.cursor = 'pointer';
    }
    if (countLabel !== null) {
      countLabel.addEventListener('click', browseAllPhotos);
      countLabel.style.cursor = 'pointer';
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

    // Load config and data
    await loadConfig();
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

    const albums = [
      ...new Set(state.photos.flatMap((p) => p.albums))
    ].sort();
    populateAlbumFilter(albums);

    updateStats(state.filteredPhotos);
  })();
});

subscribe((filtered) => {
  updateStats(filtered);
});

subscribeEdits((count) => {
  updatePendingEdits(count);
});
