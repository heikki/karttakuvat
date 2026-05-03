import { signal } from '@lit-labs/signals';

import { HAS_MML } from './features';
import { mapStyleFromUrl, mapStyleToUrl } from './filter-url';
import { effect } from './signals';

function resolveInitialMapStyle(): string {
  const saved = mapStyleFromUrl();
  if (saved === null) return 'satellite';
  if (!HAS_MML && saved.startsWith('mml_')) return 'satellite';
  return saved;
}

export const viewState = {
  mapStyle: signal(resolveInitialMapStyle())
};

effect(() => {
  mapStyleToUrl(viewState.mapStyle.get());
});
