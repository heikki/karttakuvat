import type { Point } from 'geojson';
import { LngLatBounds } from 'maplibre-gl';
import type { GeoJSONSource, LngLat, Map as MapGL } from 'maplibre-gl';

import { state } from './data';
import {
  type FeatureProps,
  type MapFeature,
  getClusterPhotos,
  getCurrentGroupIndex,
  getCurrentPopup,
  getCurrentSinglePhotoIndex,
  navigateSinglePhoto,
  scrollToActiveThumbnail,
  selectGroupPhoto,
  showMultiPhotoPopup,
  showPopup
} from './popup';

// State
let isSelecting = false;
let selectionStart: { x: number; y: number } | null = null;

// Callbacks
let getMapFn: () => MapGL = () => {
  throw new Error('Map not initialized');
};
let getMarkerLayerIdFn: () => string | null = () => null;

export function initSelectionCallbacks(
  getMap: () => MapGL,
  getMarkerLayerId: () => string | null
) {
  getMapFn = getMap;
  getMarkerLayerIdFn = getMarkerLayerId;
}

export function addSelectionLayer() {
  const map = getMapFn();
  if (map.getSource('selection') !== undefined) return;
  map.addSource('selection', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'selection-fill',
    type: 'fill',
    source: 'selection',
    paint: { 'fill-color': '#007AFF', 'fill-opacity': 0.1 }
  });
  map.addLayer({
    id: 'selection-outline',
    type: 'line',
    source: 'selection',
    paint: {
      'line-color': '#007AFF',
      'line-width': 2,
      'line-dasharray': [4, 2]
    }
  });
}

function updateSelectionLayer(
  sw: { lng: number; lat: number } | null,
  ne: { lng: number; lat: number } | null
) {
  const map = getMapFn();
  const source = map.getSource('selection');
  const geoSource =
    source !== undefined && 'setData' in source
      ? (source as GeoJSONSource)
      : undefined;
  if (sw === null || ne === null || geoSource === undefined) {
    if (geoSource !== undefined) {
      geoSource.setData({ type: 'FeatureCollection', features: [] });
    }
    return;
  }
  geoSource.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [sw.lng, sw.lat],
              [ne.lng, sw.lat],
              [ne.lng, ne.lat],
              [sw.lng, ne.lat],
              [sw.lng, sw.lat]
            ]
          ]
        },
        properties: {}
      }
    ]
  });
}

export function clearSelection() {
  updateSelectionLayer(null, null);
}

function fitToSelectionWithPopup(sw: LngLat, ne: LngLat) {
  const map = getMapFn();
  setTimeout(() => {
    // Guard against MapLibre crash when container has invalid dimensions
    const container = map.getContainer();
    if (container.clientWidth === 0 || container.clientHeight === 0) return;

    // Stop any ongoing animation before fitting bounds
    map.stop();

    const popup = getCurrentPopup();
    const popupEl = popup?.getElement();
    const popupHeight = popupEl === undefined ? 350 : popupEl.offsetHeight;
    const bounds = new LngLatBounds(sw, ne);
    try {
      map.fitBounds(bounds, {
        padding: { top: popupHeight + 20, bottom: 30, left: 20, right: 270 },
        duration: 300
      });
    } catch {
      // Silently ignore MapLibre internal errors during bounds fitting
    }
  }, 50);
}

function handleMouseDown(e: MouseEvent, container: HTMLElement) {
  if (!e.shiftKey) return;
  const rect = container.getBoundingClientRect();
  isSelecting = true;
  selectionStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  getMapFn().dragPan.disable();
  clearSelection();
  e.preventDefault();
}

function handleMouseMove(e: MouseEvent, container: HTMLElement) {
  if (!isSelecting || selectionStart === null) return;
  const map = getMapFn();
  const rect = container.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;

  const minX = Math.min(selectionStart.x, currentX);
  const minY = Math.min(selectionStart.y, currentY);
  const maxX = Math.max(selectionStart.x, currentX);
  const maxY = Math.max(selectionStart.y, currentY);

  const sw = map.unproject([minX, maxY]);
  const ne = map.unproject([maxX, minY]);
  updateSelectionLayer(sw, ne);
}

function handleMouseUp(e: MouseEvent, container: HTMLElement) {
  if (!isSelecting || selectionStart === null) return;
  const map = getMapFn();
  isSelecting = false;
  map.dragPan.enable();

  const rect = container.getBoundingClientRect();
  const endX = e.clientX - rect.left;
  const endY = e.clientY - rect.top;

  const minX = Math.min(selectionStart.x, endX);
  const minY = Math.min(selectionStart.y, endY);
  const maxX = Math.max(selectionStart.x, endX);
  const maxY = Math.max(selectionStart.y, endY);

  if (maxX - minX < 10 || maxY - minY < 10) {
    clearSelection();
    return;
  }

  const sw = map.unproject([minX, maxY]);
  const ne = map.unproject([maxX, minY]);

  const markerLayerId = getMarkerLayerIdFn();
  if (markerLayerId === null) return;

  const allFeatures = map.queryRenderedFeatures(
    [
      [minX, minY],
      [maxX, maxY]
    ],
    { layers: [markerLayerId] }
  );
  const features = allFeatures.filter((f) => {
    const geom = f.geometry as Point;
    const [lng, lat] = geom.coordinates;
    if (lng === undefined || lat === undefined) return false;
    return lng >= sw.lng && lng <= ne.lng && lat >= sw.lat && lat <= ne.lat;
  });

  if (features.length > 0) {
    const topCenterLngLat = map.unproject([(minX + maxX) / 2, minY]);
    if (features.length === 1) {
      clearSelection();
      const geom = features[0]!.geometry as Point;
      const props = features[0]!.properties as Record<string, unknown>;
      const index = props.index as number | undefined;
      if (index === undefined) return;
      const featureProps: FeatureProps = { index };
      showPopup(featureProps, geom.coordinates as [number, number]);
    } else {
      showMultiPhotoPopup(
        features as MapFeature[],
        [topCenterLngLat.lng, topCenterLngLat.lat],
        true,
        clearSelection
      );
      fitToSelectionWithPopup(sw, ne);
    }
  } else {
    clearSelection();
  }
}

function handleKeyUp(e: KeyboardEvent) {
  const map = getMapFn();
  if (e.key === 'Shift' && isSelecting) {
    isSelecting = false;
    clearSelection();
    map.dragPan.enable();
  }
}

function handleArrowNavigation(key: string) {
  const clusterPhotos = getClusterPhotos();
  const delta = key === 'ArrowRight' ? 1 : -1;

  if (clusterPhotos.length > 1) {
    const currentGroupIndex = getCurrentGroupIndex();
    const next =
      (currentGroupIndex + delta + clusterPhotos.length) % clusterPhotos.length;
    selectGroupPhoto(next);
    scrollToActiveThumbnail();
  } else {
    const singleIndex = getCurrentSinglePhotoIndex();
    if (singleIndex === null) return;
    const total = state.filteredPhotos.length;
    if (total === 0) return;
    navigateSinglePhoto((singleIndex + delta + total) % total);
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (document.querySelector('.lightbox.active') !== null) return;
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    return;
  }

  const popup = getCurrentPopup();
  if (popup === null) return;

  if (e.key === 'Escape') {
    popup.remove();
    clearSelection();
    return;
  }

  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    handleArrowNavigation(e.key);
  }
}

export function setupRectangularSelection() {
  const map = getMapFn();
  const container = map.getContainer();

  container.addEventListener('mousedown', (e) => {
    handleMouseDown(e, container);
  });

  document.addEventListener('mousemove', (e) => {
    handleMouseMove(e, container);
  });

  document.addEventListener('mouseup', (e) => {
    handleMouseUp(e, container);
  });

  document.addEventListener('keyup', handleKeyUp);
  document.addEventListener('keydown', handleKeyDown);
}
