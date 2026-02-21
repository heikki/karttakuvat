import { setApiBase } from '@common/api';
import { loadPhotos } from '@common/data';

import './components';

import { initMap } from './map';
import type { AppRPC } from './rpc-types';
import { initSave } from './save';

// Electrobun view-side RPC: receive API base URL from main process
if (location.protocol === 'views:') {
  void (async () => {
    const { Electroview } = await import('electrobun/view');
    const rpc = Electroview.defineRPC<AppRPC>({
      handlers: {
        requests: {},
        messages: {
          setApiBase: ({ url }) => {
            setApiBase(url);
          }
        }
      }
    });
    const _view = new Electroview({ rpc }); // eslint-disable-line @typescript-eslint/no-unused-vars -- side-effect: connects RPC transport
  })();
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
    initMap();
    initSave();
    await loadPhotos();
  })();
});
