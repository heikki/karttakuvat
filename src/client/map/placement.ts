import type { Map as MapGL } from 'maplibre-gl';

import { addPendingEdit, state } from '@common/data';
import { PlacementModeEvent } from '@common/events';
import type { PlacementPanel } from '@components/placement-panel';

import { getPopup, showPopup } from './popup';

let placementPhotoIndex: number | null = null;

function getPanel(): PlacementPanel {
  return document.getElementById(
    'placement-panel'
  ) as unknown as PlacementPanel;
}

export function isInPlacementMode(): boolean {
  return placementPhotoIndex !== null;
}

function showPlacementPanel(photoIndex: number) {
  const photo = state.filteredPhotos[photoIndex];
  if (photo === undefined) return;
  const panel = getPanel();
  panel.photo = photo;
  panel.active = true;
}

function hidePlacementPanel() {
  const panel = getPanel();
  panel.active = false;
}

function exitPlacementMode(map: MapGL) {
  placementPhotoIndex = null;
  map.getCanvas().classList.remove('crosshair');
  hidePlacementPanel();
  document.dispatchEvent(new PlacementModeEvent(false));
}

function finishPlacement(
  map: MapGL,
  photoIndex: number,
  lat: number,
  lon: number
) {
  const photo = state.filteredPhotos[photoIndex];
  if (photo === undefined) return;
  addPendingEdit(photo.uuid, lat, lon);
  exitPlacementMode(map);
  showPopup(photoIndex);
}

function enterPlacementMode(map: MapGL, photoIndex: number) {
  getPopup()?.remove();
  placementPhotoIndex = photoIndex;
  map.getCanvas().classList.add('crosshair');
  showPlacementPanel(photoIndex);
}

export function initPlacement(map: MapGL) {
  document.addEventListener(PlacementModeEvent.type, (e) => {
    if (!e.active) return;
    if (e.photoIndex === undefined) return;
    enterPlacementMode(map, e.photoIndex);
  });

  map.on('click', (e) => {
    if (placementPhotoIndex === null) return;

    if (state.filteredPhotos[placementPhotoIndex] === undefined) {
      exitPlacementMode(map);
      return;
    }

    e.preventDefault();
    finishPlacement(map, placementPhotoIndex, e.lngLat.lat, e.lngLat.lng);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && placementPhotoIndex !== null) {
      exitPlacementMode(map);
    }
  });
}
