import type { Map as MapGL } from 'maplibre-gl';

const WHEEL_ZOOM_RATE = 1 / 300;

let map: MapGL | null = null;
let getMarkerCoordsFn: () => [number, number] | null = () => null;
let canvasWheelHandler: ((e: WheelEvent) => void) | null = null;

// Track attached element and handlers for cleanup
let attachedEl: HTMLElement | null = null;
let mouseHandlers: Array<{
  type: string;
  handler: (e: MouseEvent) => void;
}> = [];

export function initPopupZoom(
  m: MapGL,
  getMarkerCoords: () => [number, number] | null
) {
  map = m;
  getMarkerCoordsFn = getMarkerCoords;
}

function zoomAroundPopup(e: WheelEvent) {
  if (map === null) return;
  const coords = getMarkerCoordsFn();
  if (coords === null) return;
  e.preventDefault();
  e.stopPropagation();
  const oldZoom = map.getZoom();
  const delta = -e.deltaY * WHEEL_ZOOM_RATE;
  const newZoom = Math.max(
    map.getMinZoom(),
    Math.min(map.getMaxZoom(), oldZoom + delta)
  );
  if (newZoom === oldZoom) return;
  const anchorPx = map.project(coords);
  const { clientWidth: w, clientHeight: h } = map.getCanvas();

  // If the marker is off-screen, zoom around cursor position instead
  const markerOnScreen =
    anchorPx.x >= 0 && anchorPx.x <= w && anchorPx.y >= 0 && anchorPx.y <= h;
  const rect = map.getCanvas().getBoundingClientRect();
  const zoomAnchor = markerOnScreen
    ? anchorPx
    : { x: e.clientX - rect.left, y: e.clientY - rect.top };

  const scale = 2 ** (newZoom - oldZoom);
  const newCenterPx = [
    zoomAnchor.x + (w / 2 - zoomAnchor.x) / scale,
    zoomAnchor.y + (h / 2 - zoomAnchor.y) / scale
  ] as [number, number];
  const newCenter = map.unproject(newCenterPx);
  map.jumpTo({ center: newCenter, zoom: newZoom });
}

function removePopupEvents() {
  if (attachedEl === null) return;
  attachedEl.removeEventListener('wheel', zoomAroundPopup);
  for (const { type, handler } of mouseHandlers) {
    attachedEl.removeEventListener(type, handler as EventListener);
  }
  mouseHandlers = [];
  attachedEl = null;
}

export function setupPopupEvents(popupEl: HTMLElement) {
  removePopupEvents();
  if (map === null) return;
  const canvas = map.getCanvas();
  attachedEl = popupEl;
  popupEl.addEventListener('wheel', zoomAroundPopup);
  for (const type of ['mousedown', 'mousemove', 'mouseup'] as const) {
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      canvas.dispatchEvent(new MouseEvent(type, e));
    };
    popupEl.addEventListener(type, handler);
    mouseHandlers.push({ type, handler });
  }
}

export function installCanvasZoomOverride() {
  if (map === null) return;
  map.scrollZoom.disable();
  const canvas = map.getCanvas();
  canvasWheelHandler = zoomAroundPopup;
  canvas.addEventListener('wheel', canvasWheelHandler);
}

export function removeCanvasZoomOverride() {
  if (map === null) return;
  if (canvasWheelHandler !== null) {
    map.getCanvas().removeEventListener('wheel', canvasWheelHandler);
    canvasWheelHandler = null;
  }
  map.scrollZoom.enable();
  removePopupEvents();
}
