import { loadPhotos } from '@common/data';

import './components';

import { initMap } from './map';
import { initSave } from './save';

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
    initMap();
    initSave();
    await loadPhotos();
  })();
});
