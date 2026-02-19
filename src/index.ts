import './components';

import { loadPhotos } from '@common/data';
import { initMap } from './map';
import { initKeyboard } from './keyboard';

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
    await loadPhotos();
    initKeyboard();
  })();
});
