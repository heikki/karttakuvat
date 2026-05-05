import { customElement } from 'lit/decorators.js';

import * as edits from '@common/edits';
import selection from '@common/selection';
import { effect } from '@common/signals';
import { MapFeatureElement } from '@components/map-view/api';

@customElement('map-placement')
export class MapPlacement extends MapFeatureElement {
  override firstUpdated() {
    const map = this.api.map;

    effect(() => {
      const canvas = map.getCanvas();
      if (selection.interactionMode.get() === 'placement') {
        canvas.classList.add('crosshair');
      } else {
        canvas.classList.remove('crosshair');
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
