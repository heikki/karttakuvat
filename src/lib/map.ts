import type { FeatureCollection, Point } from 'geojson';
import maplibregl from 'maplibre-gl';
import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';

import { mapStyles } from './config';
import { addPendingEdit, getEffectiveCoords, state, subscribe } from './data';
import { mapViewFromUrl, mapViewToUrl } from './filter-url';
import {
  addNightLayer,
  onProjectionChange,
  setNightLayerHidden,
  updateSunPosition
} from './night';
import { createPanToFitPopup } from './pan';
import {
  getClusterPhotos,
  getCurrentPhotoUuid,
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
import { formatDate, getThumbUrl } from './utils';

// Declare window augmentation for map
declare global {
  interface Window {
    map?: maplibregl.Map;
  }
}

// Global map variable (local to module)
// eslint-disable-next-line @typescript-eslint/init-declarations -- map is initialized in initMap() which is called before any other usage
let map: maplibregl.Map;

export function getMap(): maplibregl.Map {
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

  panel.innerHTML = `<img src="${getThumbUrl(photo)}" alt="" /><div class="placement-panel-info">${formatDate(photo.date, photo.tz)}</div><div class="placement-panel-hint">Click map to set location. Esc to cancel.</div>`;
  panel.classList.add('active');
}

function hidePlacementPanel() {
  document.getElementById('placement-panel')?.classList.remove('active');
}

const markerLayers = [
  'photo-markers',
  'photo-markers-selected',
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
  setNightLayerHidden(false);
}

function finishPlacement(photoIndex: number, lat: number, lon: number) {
  const photo = state.filteredPhotos[photoIndex];
  if (photo === undefined) return;
  addPendingEdit(photo.uuid, lat, lon);
  exitPlacementMode();
  showPopup({ index: photoIndex }, [lon, lat]);
}

export function enterPlacementMode(photoIndex: number) {
  getCurrentPopup()?.remove();
  placementPhotoIndex = photoIndex;
  map.getCanvas().classList.add('crosshair');
  showPlacementPanel(photoIndex);
  setMarkerVisibility(false);
  setNightLayerHidden(true);
}

function withGlobe(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    projection: { type: 'globe' },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0 }
  };
}

export function initMap() {
  const savedView = mapViewFromUrl();
  const center: [number, number] =
    savedView === null ? [29.52, 64.13] : [savedView.lon, savedView.lat];
  const zoom = savedView === null ? 10 : savedView.zoom;
  map = new maplibregl.Map({
    container: 'map',
    style: withGlobe(mapStyles().opentopomap as StyleSpecification),
    center,
    zoom,
    boxZoom: false,
    keyboard: false
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
  map.addControl(new maplibregl.GlobeControl(), 'bottom-right');
  map.addControl(
    new maplibregl.ScaleControl({ unit: 'metric' }),
    'bottom-left'
  );

  map.on('moveend', () => {
    const c = map.getCenter();
    mapViewToUrl({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
  });

  map.on('error', () => {
    /* ignore */
  });
  window.map = map;

  const panToFitPopup = createPanToFitPopup(map);
  const updateSun = (dateStr: string, tz: string | null, albums?: string[]) => {
    updateSunPosition({ map, dateStr, tz, albums });
  };
  initPopupCallbacks(highlightMarker, panToFitPopup, getMap, updateSun);
  initSelectionCallbacks(getMap);

  map.on('load', () => {
    addPhotoLayers();
    addSelectionLayer();
    setupMarkerInteractions();
    addNightLayer(map);
    setupRectangularSelection();

    updateMapData();
    if (savedView === null && state.filteredPhotos.length > 0) {
      fitToPhotos();
    }
  });

  map.on('projectiontransition', () => {
    onProjectionChange(map);
    const popup = getCurrentPopup();
    if (popup === null) return;
    const uuid = getCurrentPhotoUuid();
    if (uuid === null) return;
    const index = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
    if (index === -1) return;
    const photo = state.filteredPhotos[index]!;
    const { lon, lat } = getEffectiveCoords(photo);
    showPopup({ index }, [lon, lat]);
  });

  subscribe(() => {
    if (map.getSource('photos') === undefined) return;
    const uuid = getCurrentPhotoUuid();
    updateMapData();
    const popup = getCurrentPopup();
    if (popup !== null) {
      if (uuid !== null) {
        const newIndex = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
        if (newIndex !== -1) {
          const photo = state.filteredPhotos[newIndex]!;
          const { lon, lat } = getEffectiveCoords(photo);
          showPopup({ index: newIndex }, [lon, lat]);
          return;
        }
      }
      popup.remove();
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
  map.triggerRepaint();
}

export function changeMapStyle(styleKey: string) {
  const style = mapStyles()[styleKey as keyof MapStyles] as
    | StyleSpecification
    | undefined;
  if (style === undefined) return;

  // Stop any ongoing animation to prevent MapLibre crash during style change
  map.stop();

  const applyLayers = () => {
    addPhotoLayers();
    addSelectionLayer();
    setupMarkerInteractions();
    updateMapData();
    addNightLayer(map);
  };

  if (map.isStyleLoaded() !== true) {
    // Previous style still loading — wait for it before switching
    void map.once('style.load', () => {
      void map.once('style.load', applyLayers);
      map.setStyle(withGlobe(style));
    });
    return;
  }

  void map.once('style.load', applyLayers);
  map.setStyle(withGlobe(style));
}

function createGeoJSON(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: state.filteredPhotos.map((photo, index) => {
      const { lon, lat } = getEffectiveCoords(photo);
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lon, lat]
        },
        properties: {
          index,
          lat,
          gps: photo.gps ?? 'none'
        }
      };
    })
  };
}

function addPhotoLayers() {
  for (const id of [
    'photo-markers-highlight-ring',
    'photo-markers-selected',
    'photo-markers'
  ]) {
    if (map.getLayer(id) !== undefined) map.removeLayer(id);
  }
  if (map.getSource('photos') !== undefined) map.removeSource('photos');

  map.addSource('photos', {
    type: 'geojson',
    data: createGeoJSON()
  });

  const markerPaint: maplibregl.CircleLayerSpecification['paint'] = {
    'circle-color': [
      'match',
      ['get', 'gps'],
      'exif',
      '#3b82f6',
      'user',
      '#22c55e',
      'inferred',
      '#f59e0b',
      '#9ca3af'
    ],
    'circle-radius': 8,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#fff',
    'circle-pitch-alignment': 'map'
  };

  map.addLayer({
    id: 'photo-markers',
    type: 'circle',
    source: 'photos',
    layout: {
      'circle-sort-key': [
        '-',
        ['*', -1000000, ['get', 'lat']],
        ['get', 'index']
      ]
    },
    paint: markerPaint
  });

  map.addLayer({
    id: 'photo-markers-selected',
    type: 'circle',
    source: 'photos',
    paint: markerPaint,
    filter: ['==', ['get', 'index'], -1]
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
      'circle-stroke-opacity': 0.6,
      'circle-pitch-alignment': 'map'
    },
    filter: ['==', ['get', 'index'], -1]
  });
}

let pulseAnimationId: number | null = null;

function startPulseAnimation() {
  if (pulseAnimationId !== null) return;
  const start = performance.now();
  const animate = (now: number) => {
    const t = ((now - start) % 1200) / 1200;
    const radius = 12 + 8 * t;
    const opacity = 0.8 - 0.8 * t;
    if (map.getLayer('photo-markers-highlight-ring') !== undefined) {
      map.setPaintProperty(
        'photo-markers-highlight-ring',
        'circle-radius',
        radius
      );
      map.setPaintProperty(
        'photo-markers-highlight-ring',
        'circle-stroke-opacity',
        opacity
      );
    }
    pulseAnimationId = requestAnimationFrame(animate);
  };
  pulseAnimationId = requestAnimationFrame(animate);
}

function stopPulseAnimation() {
  if (pulseAnimationId !== null) {
    cancelAnimationFrame(pulseAnimationId);
    pulseAnimationId = null;
  }
}

function highlightMarker(index: number | null) {
  const filter: FilterSpecification =
    index === null
      ? ['==', ['get', 'index'], -1]
      : ['==', ['get', 'index'], index];

  for (const id of ['photo-markers-selected', 'photo-markers-highlight-ring']) {
    if (map.getLayer(id) !== undefined) map.setFilter(id, filter);
  }
  if (index === null) {
    stopPulseAnimation();
  } else {
    startPulseAnimation();
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

function showFirstPopup() {
  const photo = state.filteredPhotos[0];
  if (photo === undefined) return;
  const { lon, lat } = getEffectiveCoords(photo);
  showPopup({ index: 0 }, [lon, lat]);
}

function computePhotoBounds(): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  state.filteredPhotos.forEach((p) => bounds.extend([p.lon ?? 0, p.lat ?? 0]));
  return bounds;
}

function isSinglePointBounds(bounds: maplibregl.LngLatBounds): boolean {
  return (
    bounds.getSouthWest().lng === bounds.getNorthEast().lng &&
    bounds.getSouthWest().lat === bounds.getNorthEast().lat
  );
}

function applyFitCallback(animate: boolean, selectFirst: boolean) {
  if (animate && selectFirst) {
    void map.once('moveend', showFirstPopup);
  } else if (selectFirst) {
    showFirstPopup();
  }
}

function computeTopPadding(): number {
  if (map.getProjection().type !== 'globe') return 350;
  const popupEl = getCurrentPopup()?.getElement();
  if (popupEl === undefined) return 50;
  return Math.max(50, popupEl.getBoundingClientRect().height + 60);
}

export function fitToPhotos(animate = false, selectFirst = false) {
  if (state.filteredPhotos.length === 0) return;
  const bounds = computePhotoBounds();
  const duration = animate ? 500 : 0;

  if (isSinglePointBounds(bounds)) {
    const center = bounds.getCenter();
    map.flyTo({ center: [center.lng, center.lat], zoom: 14, duration });
    applyFitCallback(animate, selectFirst);
    return;
  }

  map.fitBounds(bounds, {
    padding: { top: computeTopPadding(), bottom: 40, left: 50, right: 270 },
    maxZoom: 18,
    duration
  });
  applyFitCallback(animate, selectFirst);
}

export { selectGroupPhotoFromPopup as selectGroupPhoto };
