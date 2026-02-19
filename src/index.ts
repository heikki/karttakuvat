import './components';

import { loadPhotos, state, subscribe } from '@common/data';
import { photoFromUrl, photoToUrl } from '@common/filter-url';
import { initGpx, loadGpxForAlbum } from './map/gpx';
import { getMap, initMap } from './map';
import { initKeyboard } from './keyboard';
import { reopenPopup } from './save';
import type { FilterPanel } from '@components/filter-panel';
import { setOnPhotoChange } from './map/popup';

function getFilterPanel(): FilterPanel {
  return document.getElementById('filter-panel') as unknown as FilterPanel;
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
