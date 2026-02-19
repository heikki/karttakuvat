import './components';

import { loadPhotos } from '@common/data';
import { photoFromUrl, photoToUrl } from '@common/filter-url';
import { initMap } from './map';
import { initKeyboard } from './keyboard';
import { reopenPopup } from './save';
import { setOnPhotoChange } from './map/popup';

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
    initKeyboard();
    setOnPhotoChange(photoToUrl);
    reopenPopup(photoFromUrl());
  })();
});
