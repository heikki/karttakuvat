import selection from '@common/selection';
import { showAlbumFiles } from '@components/files-modal';
import { MapMeasure } from '@components/map-measure';
import { toggleRouteEdit as toggleRouteEditImpl } from '@components/map-route/edit';
import { showMetadata } from '@components/metadata-modal';
import { showLightbox } from '@components/photo-lightbox';

import { saveEdits as saveEditsImpl } from '../save';
import { viewState } from './view-state';

export { showAlbumFiles, showLightbox, showMetadata };

function getMapView(): HTMLElementTagNameMap['map-view'] | null {
  return document.querySelector('map-view');
}

export function fitToPhotos(animate = false, selectFirst = false): void {
  getMapView()?.fitToPhotos(animate, selectFirst);
}

export function resetMap(): void {
  selection.clear();
  viewState.mapStyle.set('satellite');
  viewState.markerStyle.set('classic');
  viewState.routeVisible.set(false);
  getMapView()?.fitToPhotos(true);
}

export function openExternalMap(provider: 'apple' | 'google'): void {
  getMapView()?.openExternal(provider);
}

export function toggleMeasure(): void {
  MapMeasure.toggle();
}

export function toggleRouteEdit(): void {
  toggleRouteEditImpl();
}

export function reloadAlbumGpx(): void {
  getMapView()?.reloadGpx();
}

export function saveEdits(): void {
  void saveEditsImpl();
}

export function enterPlacement(): void {
  selection.enterPlacement();
}
