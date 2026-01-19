import { applyFilters, loadPhotos, state, subscribe } from './lib/data';
import { changeMapStyle, initMap, selectGroupPhoto } from './lib/map';
import {
  browseAllPhotos,
  initUI,
  populateYearFilter,
  showGroupLightbox,
  showLightbox,
  updateLightboxGroup,
  updateStats
} from './lib/ui';
import { getYear } from './lib/utils';

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
(window as any).selectGroupPhoto = selectGroupPhoto;
(window as any).showLightbox = showLightbox;
(window as any).showGroupLightbox = showGroupLightbox;

document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    initUI();

    // Event Listeners
    const mapSelect = document.getElementById('map-select');
    if (mapSelect) {
      mapSelect.addEventListener('change', (e) => {
        changeMapStyle((e.target as HTMLSelectElement).value);
      });
    }

    const yearSelect = document.getElementById('year-select');
    const gpsSelect = document.getElementById('gps-select');

    const handleFilterChange = () => {
      const y = (yearSelect as HTMLSelectElement).value;
      const g = (gpsSelect as HTMLSelectElement).value;
      applyFilters(y, g);
    };

    if (yearSelect) yearSelect.addEventListener('change', handleFilterChange);
    if (gpsSelect) gpsSelect.addEventListener('change', handleFilterChange);

    // Stats interactions
    const countEl = document.getElementById('photo-count');
    const countLabel = countEl?.nextElementSibling as HTMLElement;
    if (countEl) {
      countEl.addEventListener('click', browseAllPhotos);
      countEl.style.cursor = 'pointer';
    }
    if (countLabel) {
      countLabel.addEventListener('click', browseAllPhotos);
      countLabel.style.cursor = 'pointer';
    }

    // Load Data
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
    updateStats(state.filteredPhotos);
  })();
});

subscribe((filtered) => {
  updateStats(filtered);
});
