import type { Map as MapGL } from 'maplibre-gl';

const WHEEL_ZOOM_RATE = 1 / 300;

let getMapFn: () => MapGL | undefined = () => undefined;
let getMarkerCoordsFn: () => [number, number] | null = () => null;
let canvasWheelHandler: ((e: WheelEvent) => void) | null = null;

export function initPopupZoom(
  getMap: () => MapGL | undefined,
  getMarkerCoords: () => [number, number] | null
) {
  getMapFn = getMap;
  getMarkerCoordsFn = getMarkerCoords;
}

function zoomAroundPopup(e: WheelEvent) {
  const map = getMapFn();
  if (map === undefined) return;
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
  const scale = 2 ** (newZoom - oldZoom);
  const newCenterPx = [
    anchorPx.x + (w / 2 - anchorPx.x) / scale,
    anchorPx.y + (h / 2 - anchorPx.y) / scale
  ] as [number, number];
  const newCenter = map.unproject(newCenterPx);
  map.jumpTo({ center: newCenter, zoom: newZoom });
}

export function setupPopupEvents(popupEl: HTMLElement) {
  const map = getMapFn();
  if (map === undefined) return;
  const canvas = map.getCanvas();
  popupEl.addEventListener('wheel', zoomAroundPopup);
  for (const type of ['mousedown', 'mousemove', 'mouseup'] as const) {
    popupEl.addEventListener(type, (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, .thumb-strip') !== null) return;
      e.preventDefault();
      canvas.dispatchEvent(new MouseEvent(type, e));
    });
  }
}

export function installCanvasZoomOverride() {
  const map = getMapFn();
  if (map === undefined) return;
  map.scrollZoom.disable();
  const canvas = map.getCanvas();
  canvasWheelHandler = zoomAroundPopup;
  canvas.addEventListener('wheel', canvasWheelHandler);
}

export function removeCanvasZoomOverride() {
  const map = getMapFn();
  if (map === undefined) return;
  if (canvasWheelHandler !== null) {
    map.getCanvas().removeEventListener('wheel', canvasWheelHandler);
    canvasWheelHandler = null;
  }
  map.scrollZoom.enable();
}
