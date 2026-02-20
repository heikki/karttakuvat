import type { Map as MapGL } from 'maplibre-gl';

import { getPopup } from './popup';

const PADDING = { top: 10, bottom: 10, left: 10, right: 10 };

function getPopupRect(map: MapGL): {
  mapRect: DOMRect;
  popupRect: DOMRect;
} | null {
  const popup = getPopup();
  if (popup === null) return null;
  const mapContainer = map.getContainer();
  if (mapContainer.clientWidth === 0 || mapContainer.clientHeight === 0) {
    return null;
  }
  const popupEl = popup.getElement() as HTMLElement | undefined;
  if (popupEl === undefined) return null;
  return {
    mapRect: mapContainer.getBoundingClientRect(),
    popupRect: popupEl.getBoundingClientRect()
  };
}

function calculatePanOffset(
  mapRect: DOMRect,
  popupRect: DOMRect
): { panX: number; panY: number } {
  let panX = 0;
  let panY = 0;

  if (popupRect.top < mapRect.top + PADDING.top) {
    panY = popupRect.top - mapRect.top - PADDING.top;
  } else if (popupRect.bottom > mapRect.bottom - PADDING.bottom) {
    panY = popupRect.bottom - mapRect.bottom + PADDING.bottom;
  }

  if (popupRect.left < mapRect.left + PADDING.left) {
    panX = popupRect.left - mapRect.left - PADDING.left;
  } else if (popupRect.right > mapRect.right - PADDING.right) {
    panX = popupRect.right - mapRect.right + PADDING.right;
  }

  return { panX, panY };
}

/** Wait for popup layout to settle, then call fn with rects. */
function afterPopupLayout(map: MapGL, fn: () => void) {
  // Double rAF ensures the browser has painted the popup at its final position
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fn();
    });
  });
}

function panBy(map: MapGL, panX: number, panY: number, duration: number) {
  if (panX === 0 && panY === 0) return;
  try {
    map.panBy([panX, panY], { duration });
  } catch {
    // Silently ignore MapLibre internal errors
  }
}

/**
 * Pan the map to fit the popup after opening it on the current view.
 * Used for initial popup show (click on marker).
 */
export function createPanToFitPopup(map: MapGL) {
  return (_coords: [number, number]) => {
    afterPopupLayout(map, () => {
      map.stop();
      const rects = getPopupRect(map);
      if (rects === null) return;
      const { panX, panY } = calculatePanOffset(rects.mapRect, rects.popupRect);
      panBy(map, panX, panY, 300);
    });
  };
}

/**
 * Fly the map to center on coordinates, then fine-tune to fit the popup.
 * Used for arrow-key navigation between photos.
 */
export function createFlyToPopup(map: MapGL) {
  return (coords: [number, number]) => {
    // First, ease to the target coordinates so the marker is centered
    try {
      map.stop();
      map.easeTo({
        center: coords,
        duration: 300
      });
    } catch {
      return;
    }

    // After the ease animation completes, fine-tune pan for popup fit
    const onMoveEnd = () => {
      map.off('moveend', onMoveEnd);
      afterPopupLayout(map, () => {
        const rects = getPopupRect(map);
        if (rects === null) return;
        const { panX, panY } = calculatePanOffset(
          rects.mapRect,
          rects.popupRect
        );
        panBy(map, panX, panY, 200);
      });
    };
    map.on('moveend', onMoveEnd);
  };
}
