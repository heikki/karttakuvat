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

async function restoreViewState(): Promise<void> {
  if (location.search !== '') return;
  try {
    const res = await fetch('/api/view-state');
    if (res.status !== 200) return;
    const obj = (await res.json()) as Record<string, string>;
    const qs = new URLSearchParams(obj).toString();
    if (qs !== '') history.replaceState(null, '', `?${qs}`);
  } catch {
    // ignore
  }
}

// Init
function init() {
  void (async () => {
    await restoreViewState();
    initMap();
    initSave();
    await loadPhotos();
  })();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
