import type maplibregl from 'maplibre-gl';

import { addPendingEdit, state } from './data';
import { getCurrentPopup, showPopup } from './popup';
import { formatDate, getThumbUrl } from './utils';

let placementPhotoIndex: number | null = null;
// eslint-disable-next-line @typescript-eslint/no-empty-function -- set in setupPlacement
let markerVisibility: (visible: boolean) => void = () => {};

export function isInPlacementMode(): boolean {
  return placementPhotoIndex !== null;
}

function showPlacementPanel(photoIndex: number) {
  const photo = state.filteredPhotos[photoIndex];
  if (photo === undefined) return;

  let panel = document.getElementById('placement-panel');
  if (panel === null) {
    panel = document.createElement('div');
    panel.id = 'placement-panel';
    document.body.appendChild(panel);
  }

  panel.innerHTML = `<img src="${getThumbUrl(photo)}" alt="" /><div class="placement-panel-info">${formatDate(photo.date, photo.tz)}</div><div class="placement-panel-hint">Click map to set location. Esc to cancel.</div>`;
  panel.classList.add('active');
}

function hidePlacementPanel() {
  document.getElementById('placement-panel')?.classList.remove('active');
}

function exitPlacementMode(map: maplibregl.Map) {
  placementPhotoIndex = null;
  map.getCanvas().classList.remove('crosshair');
  hidePlacementPanel();
  markerVisibility(true);
}

function finishPlacement(
  map: maplibregl.Map,
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

export function enterPlacementMode(
  map: maplibregl.Map,
  photoIndex: number
) {
  getCurrentPopup()?.remove();
  placementPhotoIndex = photoIndex;
  map.getCanvas().classList.add('crosshair');
  showPlacementPanel(photoIndex);
  markerVisibility(false);
}

export function setupPlacement(
  map: maplibregl.Map,
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
