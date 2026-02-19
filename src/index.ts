import { loadPhotos } from '@common/data';

import './components';
import { initKeyboard } from './keyboard';
import { initMap } from './map';

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
