import fit from '@map/fit';
import gpx from '@map/gpx';
import map from '@map/index';
import measure from '@map/measure';
import { toggleRouteEdit as toggleRouteEditImpl } from '@map/route/edit';
import selection from '@map/selection';

import { showAlbumFiles } from '@components/album-files-modal';
import { showMetadata } from '@components/metadata-modal';
import { showLightbox } from '@components/photo-lightbox';

import { saveEdits as saveEditsImpl } from '../save';
import { viewState } from './view-state';

export { showAlbumFiles, showLightbox, showMetadata };

export function fitToPhotos(animate = false, selectFirst = false): void {
  fit.toPhotos(animate, selectFirst);
}

export function resetMap(): void {
  selection.clear();
  viewState.mapStyle.set('satellite');
  viewState.markerStyle.set('classic');
  viewState.routeVisible.set(false);
  fit.toPhotos(true);
}

export function openExternalMap(provider: 'apple' | 'google'): void {
  map.openExternal(provider);
}

export function toggleMeasure(): void {
  measure.toggle();
}

export function toggleRouteEdit(): void {
  toggleRouteEditImpl();
}

export function reloadAlbumGpx(): void {
  gpx.reloadTracks();
}

export function saveEdits(): void {
  void saveEditsImpl();
}

export function enterPlacement(): void {
  selection.enterPlacement();
}
