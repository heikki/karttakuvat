import { signal } from '@lit-labs/signals';

import { HAS_MML } from './features';
import {
  mapStyleFromUrl,
  mapStyleToUrl,
  routeFromUrl,
  routeToUrl
} from './filter-url';
import { effect } from './signals';

function resolveInitialMapStyle(): string {
  const saved = mapStyleFromUrl();
  if (saved === null) return 'satellite';
  if (!HAS_MML && saved.startsWith('mml_')) return 'satellite';
  return saved;
}

export const viewState = {
  mapStyle: signal(resolveInitialMapStyle()),
  routeVisible: signal(routeFromUrl())
};

effect(() => {
  mapStyleToUrl(viewState.mapStyle.get());
});

effect(() => {
  routeToUrl(viewState.routeVisible.get());
});
