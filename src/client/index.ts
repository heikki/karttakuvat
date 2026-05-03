import * as data from '@common/data';

import './components';

import map from './map';
import { initSave } from './save';

// --- Debug: catch uncaught errors and show on screen ---
const debugLog: string[] = [];
function debugPush(msg: string) {
  debugLog.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (debugLog.length > 50) debugLog.shift();
  console.error('[debug]', msg);
}
window.addEventListener('error', (e) => {
  debugPush(`ERR: ${e.message} at ${e.filename}:${e.lineno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  debugPush(`REJECT: ${e.reason}`);
});
// Expose debug log for Safari Inspector: type `window.__debugLog` in console
(window as unknown as Record<string, unknown>).__debugLog = debugLog;
(window as unknown as Record<string, unknown>).__showDebug = () => {
  const text = debugLog.slice(-20).join('\n');
  // eslint-disable-next-line no-alert -- debug-only function, not shown in UI
  alert(text === '' ? '(no errors logged)' : text);
};

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
function init() {
  void (async () => {
    map.init();
    initSave();
    await data.loadPhotos();
  })();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
