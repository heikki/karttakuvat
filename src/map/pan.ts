import type { Map as MapGL } from 'maplibre-gl';

import { getCurrentPopup } from '@components/photo-popup/popup';

function calculatePanOffset(
  mapRect: DOMRect,
  popupRect: DOMRect
): { panX: number; panY: number } {
  const padding = { top: 10, right: 260, bottom: 10, left: 10 };
  let panX = 0;
  let panY = 0;

  if (popupRect.top < mapRect.top + padding.top) {
    panY = popupRect.top - mapRect.top - padding.top;
  } else if (popupRect.bottom > mapRect.bottom - padding.bottom) {
    panY = popupRect.bottom - mapRect.bottom + padding.bottom;
  }

  if (popupRect.left < mapRect.left + padding.left) {
    panX = popupRect.left - mapRect.left - padding.left;
  } else if (popupRect.right > mapRect.right - padding.right) {
    panX = popupRect.right - mapRect.right + padding.right;
  }

  return { panX, panY };
}

export function createPanToFitPopup(map: MapGL) {
  return (_coords: [number, number]) => {
    setTimeout(() => {
      const popup = getCurrentPopup();
      if (popup === null) return;

      const mapContainer = map.getContainer();
      if (mapContainer.clientWidth === 0 || mapContainer.clientHeight === 0) {
        return;
      }

      map.stop();

      const popupEl = popup.getElement() as HTMLElement | undefined;
      if (popupEl === undefined) return;
      const mapRect = mapContainer.getBoundingClientRect();
      const popupRect = popupEl.getBoundingClientRect();
      const { panX, panY } = calculatePanOffset(mapRect, popupRect);

      if (panX !== 0 || panY !== 0) {
        try {
          map.panBy([panX, panY], { duration: 300 });
        } catch {
          // Silently ignore MapLibre internal errors
        }
      }
    }, 50);
  };
}
