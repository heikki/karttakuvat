import type { Map as MapGL } from 'maplibre-gl';

import * as edits from '@common/edits';
import type { PlacementPanel } from '@components/placement-panel';

import selection from './selection';

function getPanel(): PlacementPanel {
  return document.getElementById(
    'placement-panel'
  ) as unknown as PlacementPanel;
}

function init(map: MapGL): void {
  selection.subscribe(() => {
    const panel = getPanel();
    if (selection.getMode() === 'placement') {
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
    if (selection.getMode() !== 'placement') return;
    const uuid = selection.getPhotoUuid();
    if (uuid === null) {
      selection.clear();
      return;
    }
    e.preventDefault();
    edits.setCoord(uuid, e.lngLat.lat, e.lngLat.lng);
    selection.openPopup(uuid);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selection.getMode() === 'placement') {
      selection.clear();
    }
  });
}

export default { init };
