import { customElement } from 'lit/decorators.js';

import * as edits from '@common/edits';
import selection from '@common/selection';
import { effect } from '@common/signals';
import { MapFeatureElement } from '@components/map-view/api';
import type { PlacementPanel } from '@components/placement-panel';

function getPanel(): PlacementPanel {
  return document.getElementById(
    'placement-panel'
  ) as unknown as PlacementPanel;
}

@customElement('map-placement')
export class MapPlacement extends MapFeatureElement {
  override firstUpdated() {
    const map = this.api.map;

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
      if (
        e.key === 'Escape' &&
        selection.interactionMode.get() === 'placement'
      ) {
        selection.clear();
      }
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-placement': MapPlacement;
  }
}
