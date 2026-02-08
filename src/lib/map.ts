import type { FeatureCollection, Point } from 'geojson';
import maplibregl from 'maplibre-gl';
import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';

import { mapStyles } from './config';
import { addPendingEdit, getCopiedLocation, state, subscribe } from './data';
import { formatDate, getThumbUrl } from './utils';
import {
  getClusterPhotos,
  getCurrentPopup,
  initPopupCallbacks,
  scrollToActiveThumbnail,
  selectGroupPhoto as selectGroupPhotoFromPopup,
  showPopup
} from './popup';
import {
  addSelectionLayer,
  initSelectionCallbacks,
  setupRectangularSelection
} from './selection';
import type { MapStyles } from './types';

// Declare window augmentation for map
declare global {
  interface Window {
    map?: maplibregl.Map;
  }
}

// Global map variable (local to module)
// eslint-disable-next-line @typescript-eslint/init-declarations -- map is initialized in initMap() which is called before any other usage
let map: maplibregl.Map;

function getMap(): maplibregl.Map {
  return map;
}

// Placement mode state
let placementPhotoIndex: number | null = null;

function showPlacementPanel(photoIndex: number) {
  const photo = state.filteredPhotos[photoIndex];
  if (photo === undefined) return;

  let panel = document.getElementById('placement-panel');
  if (panel === null) {
    panel = document.createElement('div');
    panel.id = 'placement-panel';
    document.body.appendChild(panel);
  }

  const copied = getCopiedLocation();
  const pasteHtml =
    copied === null
      ? ''
      : `<a class="placement-panel-paste" href="#" id="paste-location">Paste location<br><span>${copied.lat.toFixed(4)}°N, ${copied.lon.toFixed(4)}°E</span></a>`;

  panel.innerHTML = `<img src="${getThumbUrl(photo)}" alt="" /><div class="placement-panel-info">${formatDate(photo.date)}</div><div class="placement-panel-hint">Click map to set location. Esc to cancel.</div>${pasteHtml}`;
  panel.classList.add('active');

  if (copied !== null) {
    const pasteLink = document.getElementById('paste-location');
    if (pasteLink !== null) {
      pasteLink.onclick = (ev) => {
        ev.preventDefault();
        finishPlacement(photoIndex, copied.lat, copied.lon);
      };
    }
  }
}

function hidePlacementPanel() {
  const panel = document.getElementById('placement-panel');
  if (panel !== null) {
    panel.classList.remove('active');
  }
}

const markerLayers = [
  'photo-markers',
  'photo-markers-highlight',
  'photo-markers-highlight-ring'
];

function setMarkerVisibility(visible: boolean) {
  const visibility = visible ? 'visible' : 'none';
  for (const id of markerLayers) {
    if (map.getLayer(id) !== undefined) {
      map.setLayoutProperty(id, 'visibility', visibility);
    }
  }
}

function exitPlacementMode() {
  placementPhotoIndex = null;
  map.getCanvas().classList.remove('crosshair');
  hidePlacementPanel();
  setMarkerVisibility(true);
}

function finishPlacement(photoIndex: number, lat: number, lon: number) {
  const photo = state.filteredPhotos[photoIndex];
  if (photo === undefined) return;

  addPendingEdit(photo.uuid, lat, lon);
  exitPlacementMode();
  showPopup({ index: photoIndex }, [lon, lat]);
}

export function enterPlacementMode(photoIndex: number) {
  // Close any open popup
  const popup = getCurrentPopup();
  if (popup !== null) {
    popup.remove();
  }

  placementPhotoIndex = photoIndex;
  map.getCanvas().classList.add('crosshair');
  showPlacementPanel(photoIndex);
  setMarkerVisibility(false);
}

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: mapStyles.opentopomap as StyleSpecification,
    center: [29.52, 64.13],
    zoom: 10,
    boxZoom: false,
    keyboard: false
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

  // Handle MapLibre internal errors gracefully
  map.on('error', () => {
    // Silently ignore MapLibre internal errors
  });

  // Expose map to window
  window.map = map;

  // Initialize callbacks for other modules
  initPopupCallbacks(highlightMarker, panToFitPopup, getMap);
  initSelectionCallbacks(getMap);

  map.on('load', () => {
    addPhotoLayers();
    addSelectionLayer();
    setupMarkerInteractions();
    setupRectangularSelection();

    updateMapData();
    if (state.filteredPhotos.length > 0) {
      fitToPhotos();
    }
  });

  subscribe(() => {
    if (map.isStyleLoaded() === true) {
      updateMapData();
    }
  });

  // Placement mode: click to set location
  map.on('click', (e) => {
    if (placementPhotoIndex === null) return;

    if (state.filteredPhotos[placementPhotoIndex] === undefined) {
      exitPlacementMode();
      return;
    }

    e.preventDefault();
    finishPlacement(placementPhotoIndex, e.lngLat.lat, e.lngLat.lng);
  });

  // Esc to cancel placement mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && placementPhotoIndex !== null) {
      exitPlacementMode();
    }
  });
}

function updateMapData() {
  const source = map.getSource('photos');
  if (source === undefined) return;

  const geoSource = source as maplibregl.GeoJSONSource;
  geoSource.setData(createGeoJSON());
}

export function changeMapStyle(styleKey: string) {
  const style = mapStyles[styleKey as keyof MapStyles] as
    | StyleSpecification
    | undefined;
  if (style === undefined) return;

  // Stop any ongoing animation to prevent MapLibre crash during style change
  map.stop();
  map.setStyle(style);
  void map.once('idle', () => {
    addPhotoLayers();
    addSelectionLayer();
    setupMarkerInteractions();
    updateMapData();
  });
}

function createGeoJSON(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: state.filteredPhotos.map((photo, index) => {
      const pending = state.pendingEdits.get(photo.uuid);
      const lon = pending === undefined ? (photo.lon ?? 0) : pending.lon;
      const lat = pending === undefined ? (photo.lat ?? 0) : pending.lat;
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lon, lat]
        },
        properties: {
          index,
          lat
        }
      };
    })
  };
}

function addPhotoLayers() {
  if (map.getLayer('photo-markers-highlight-ring') !== undefined) {
    map.removeLayer('photo-markers-highlight-ring');
  }
  if (map.getLayer('photo-markers-highlight') !== undefined) {
    map.removeLayer('photo-markers-highlight');
  }
  if (map.getLayer('photo-markers') !== undefined) {
    map.removeLayer('photo-markers');
  }
  if (map.getSource('photos') !== undefined) {
    map.removeSource('photos');
  }

  map.addSource('photos', {
    type: 'geojson',
    data: createGeoJSON()
  });

  map.addLayer({
    id: 'photo-markers-highlight-ring',
    type: 'circle',
    source: 'photos',
    paint: {
      'circle-color': 'transparent',
      'circle-radius': 18,
      'circle-stroke-width': 3,
      'circle-stroke-color': '#007AFF',
      'circle-stroke-opacity': 0.6
    },
    filter: ['==', ['get', 'index'], -1]
  });

  map.addLayer({
    id: 'photo-markers',
    type: 'circle',
    source: 'photos',
    layout: {
      'circle-sort-key': ['*', -1, ['get', 'lat']]
    },
    paint: {
      'circle-color': '#3b82f6',
      'circle-radius': 8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff'
    }
  });

  map.addLayer({
    id: 'photo-markers-highlight',
    type: 'circle',
    source: 'photos',
    paint: {
      'circle-color': '#f59e0b',
      'circle-radius': 10,
      'circle-stroke-width': 3,
      'circle-stroke-color': '#fff'
    },
    filter: ['==', ['get', 'index'], -1]
  });
}

function highlightMarker(index: number | null) {
  const filter: FilterSpecification =
    index === null
      ? ['==', ['get', 'index'], -1]
      : ['==', ['get', 'index'], index];

  if (map.getLayer('photo-markers-highlight') !== undefined) {
    map.setFilter('photo-markers-highlight', filter);
  }
  if (map.getLayer('photo-markers-highlight-ring') !== undefined) {
    map.setFilter('photo-markers-highlight-ring', filter);
  }
}

function setupMarkerInteractions() {
  map.on('click', 'photo-markers', (e) => {
    // In placement mode, let the map-level click handler handle it
    if (placementPhotoIndex !== null) return;

    e.preventDefault();
    e.originalEvent.stopPropagation();

    if (e.features === undefined || e.features.length === 0) {
      return;
    }
    const feature = e.features[0]!;
    const clickedIndex = feature.properties.index as number | undefined;

    // Check if part of cluster
    const popup = getCurrentPopup();
    const clusterPhotos = getClusterPhotos();
    if (popup !== null && clusterPhotos.length > 1) {
      const groupIndex = clusterPhotos.findIndex(
        (p) => p._index === clickedIndex
      );
      if (groupIndex !== -1) {
        selectGroupPhotoFromPopup(groupIndex);
        scrollToActiveThumbnail();
        return;
      }
    }

    const geom = feature.geometry as Point;
    const coords: [number, number] = [
      geom.coordinates[0]!,
      geom.coordinates[1]!
    ];
    if (clickedIndex === undefined) return;
    showPopup({ index: clickedIndex }, coords);
  });

  map.on('mouseenter', 'photo-markers', () => {
    if (placementPhotoIndex === null) {
      map.getCanvas().style.cursor = 'pointer';
    }
  });
  map.on('mouseleave', 'photo-markers', () => {
    if (placementPhotoIndex === null) {
      map.getCanvas().style.cursor = '';
    }
  });

  map.on('click', (e) => {
    // In placement mode, don't close popups on empty clicks
    if (placementPhotoIndex !== null) return;

    const features = map.queryRenderedFeatures(e.point, {
      layers: ['photo-markers']
    });
    if (features.length > 0) return;
    const selectionFeatures = map.queryRenderedFeatures(e.point, {
      layers: ['selection-fill']
    });
    if (selectionFeatures.length > 0) return;
    const popup = getCurrentPopup();
    if (popup !== null) {
      popup.remove();
    }
  });
}

function calculatePanOffset(
  mapRect: DOMRect,
  popupRect: DOMRect
): { panX: number; panY: number } {
  const padding = { top: 10, right: 260, bottom: 120, left: 10 };
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

function panToFitPopup(coords: [number, number]) {
  setTimeout(() => {
    const popup = getCurrentPopup();
    if (popup === null) return;

    // Guard against MapLibre crash when container has invalid dimensions
    const mapContainer = map.getContainer();
    if (mapContainer.clientWidth === 0 || mapContainer.clientHeight === 0) {
      return;
    }

    // Stop any ongoing animation before panning
    map.stop();

    const popupEl = popup.getElement();
    const mapRect = mapContainer.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();
    const { panX, panY } = calculatePanOffset(mapRect, popupRect);

    if (panX !== 0 || panY !== 0) {
      safeMapOperation(() => {
        map.panBy([panX, panY], { duration: 300 });
      });
    }
  }, 50);
}

function isSinglePointBounds(bounds: maplibregl.LngLatBounds): boolean {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return sw.lng === ne.lng && sw.lat === ne.lat;
}

function safeMapOperation(operation: () => void) {
  try {
    operation();
  } catch {
    // Silently ignore MapLibre internal errors
  }
}

function fitToPhotos() {
  if (state.filteredPhotos.length === 0) return;

  const bounds = new maplibregl.LngLatBounds();
  state.filteredPhotos.forEach((p) => bounds.extend([p.lon ?? 0, p.lat ?? 0]));

  if (isSinglePointBounds(bounds)) {
    const center = bounds.getCenter();
    map.setCenter([center.lng, center.lat]);
    return;
  }

  map.fitBounds(bounds, {
    padding: { top: 20, bottom: 150, left: 20, right: 270 },
    maxZoom: 18,
    duration: 0
  });
}

// Re-export for index.ts
export { selectGroupPhotoFromPopup as selectGroupPhoto };
