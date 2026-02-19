import type { Map as MapGL } from 'maplibre-gl';

import { addPendingEdit, state } from '@common/data';
import { getCurrentPopup, showPopup } from './popup';
import type { PlacementPanel } from '@components/placement-panel';

let placementPhotoIndex: number | null = null;
// eslint-disable-next-line @typescript-eslint/no-empty-function -- set in setupPlacement
let markerVisibility: (visible: boolean) => void = () => {};

function getPanel(): PlacementPanel {
  return document.getElementById('placement-panel') as unknown as PlacementPanel;
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
  markerVisibility(true);
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
  showPopup({ index: photoIndex }, [lon, lat]);
}

export function enterPlacementMode(map: MapGL, photoIndex: number) {
  getCurrentPopup()?.remove();
  placementPhotoIndex = photoIndex;
  map.getCanvas().classList.add('crosshair');
  showPlacementPanel(photoIndex);
  markerVisibility(false);
}

export function setupPlacement(
  map: MapGL,
  setVisibility: (visible: boolean) => void
) {
  markerVisibility = setVisibility;

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
