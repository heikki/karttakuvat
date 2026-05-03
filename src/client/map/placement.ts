import type { Map as MapGL } from 'maplibre-gl';

import * as edits from '@common/edits';
import { effect } from '@common/signals';
import type { PlacementPanel } from '@components/placement-panel';

import selection from './selection';

function getPanel(): PlacementPanel {
  return document.getElementById(
    'placement-panel'
  ) as unknown as PlacementPanel;
}

function init(map: MapGL): void {
  effect(() => {
    const panel = getPanel();
    if (selection.interactionMode.get() === 'placement') {
      const photo = selection.getPhoto();
      if (photo === undefined) return;
      panel.photo = photo;
      panel.active = true;
      map.getCanvas().classList.add('crosshair');
    } else {
      panel.active = false;
      map.getCanvas().classList.remove('crosshair');
    }
  });

  map.on('click', (e) => {
    if (selection.interactionMode.get() !== 'placement') return;
    const uuid = selection.selectedPhotoUuid.get();
    if (uuid === null) {
      selection.clear();
      return;
    }
    e.preventDefault();
    edits.setCoord(uuid, e.lngLat.lat, e.lngLat.lng);
    // Selecting the same uuid cancels placement (back to popup view).
    selection.selectPhoto(uuid);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selection.interactionMode.get() === 'placement') {
      selection.clear();
    }
  });
}

export default { init };
