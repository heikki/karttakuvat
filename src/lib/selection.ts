import type { Point } from 'geojson';
import maplibregl from 'maplibre-gl';

import {
  type FeatureProps,
  type MapFeature,
  getClusterPhotos,
  getCurrentGroupIndex,
  getCurrentPopup,
  scrollToActiveThumbnail,
  selectGroupPhoto,
  showMultiPhotoPopup,
  showPopup
} from './popup';

// State
let isSelecting = false;
let selectionStart: { x: number; y: number } | null = null;

// Callbacks
let getMapFn: () => maplibregl.Map = () => {
  throw new Error('Map not initialized');
};

export function initSelectionCallbacks(getMap: () => maplibregl.Map) {
  getMapFn = getMap;
}

export function addSelectionLayer() {
  const map = getMapFn();
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
      ? (source as maplibregl.GeoJSONSource)
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

export function fitToSelectionWithPopup(
  sw: maplibregl.LngLat,
  ne: maplibregl.LngLat
) {
  const map = getMapFn();
  setTimeout(() => {
    const popup = getCurrentPopup();
    const popupEl = popup?.getElement();
    const popupHeight = popupEl === undefined ? 350 : popupEl.offsetHeight;
    const bounds = new maplibregl.LngLatBounds(sw, ne);
    map.fitBounds(bounds, {
      padding: { top: popupHeight + 20, bottom: 30, left: 20, right: 270 },
      duration: 300
    });
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

  const allFeatures = map.queryRenderedFeatures(
    [
      [minX, minY],
      [maxX, maxY]
    ],
    { layers: ['photo-markers'] }
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

function handleKeyDown(e: KeyboardEvent) {
  // Ignore if lightbox is active
  if (document.querySelector('.lightbox.active') !== null) return;

  const popup = getCurrentPopup();
  // Ignore if no popup
  if (popup === null) return;

  if (e.key === 'Escape') {
    popup.remove();
    clearSelection();
    return;
  }

  const clusterPhotos = getClusterPhotos();
  // Navigation requires multiple photos
  if (clusterPhotos.length <= 1) return;

  const currentGroupIndex = getCurrentGroupIndex();
  if (e.key === 'ArrowRight') {
    const nextIndex = (currentGroupIndex + 1) % clusterPhotos.length;
    selectGroupPhoto(nextIndex);
    scrollToActiveThumbnail();
  } else if (e.key === 'ArrowLeft') {
    const prevIndex =
      (currentGroupIndex - 1 + clusterPhotos.length) % clusterPhotos.length;
    selectGroupPhoto(prevIndex);
    scrollToActiveThumbnail();
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
