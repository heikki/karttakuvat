import type { FeatureCollection, Point } from 'geojson';
import maplibregl from 'maplibre-gl';
import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';

import { mapStyles } from './config';
import { getEffectiveCoords, state, subscribe } from './data';
import { fitToPhotos, initFit } from './fit';
import { mapViewFromUrl, mapViewToUrl } from './filter-url';
import { initGlobeBackground, setMapIdle, startGlobeBackground, stopGlobeBackground } from './globe-background';
import { updateGlobeRadius } from './globe-radius';
import { PhotoGlowLayer } from './glow-layer';
import { defaultMarkerStyle, markerStyles } from './marker-styles';
import { addMeasureLayers, initMeasure } from './measure';
import { setGlowLayer, onProjectionChange, updateSunPosition } from './night';
import { createPanToFitPopup } from './pan';
import { enterPlacementMode as enterPlacement, isInPlacementMode, setupPlacement } from './placement';
import { getClusterPhotos, getCurrentPhotoUuid, getCurrentPopup, initPopupCallbacks, scrollToActiveThumbnail, selectGroupPhoto as selectGroupPhotoFromPopup, showPopup } from './popup';
import { addSelectionLayer, initSelectionCallbacks, setupRectangularSelection } from './selection';
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

export function getMap(): maplibregl.Map {
  return map;
}

let currentMarkerStyle = defaultMarkerStyle;
let currentGlowLayer: PhotoGlowLayer | null = null;

let markerLayers = [
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

export function enterPlacementMode(photoIndex: number) {
  enterPlacement(map, photoIndex);
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
    style: withGlobe(mapStyles().satellite as StyleSpecification),
    center,
    zoom,
    boxZoom: false,
    keyboard: false,
    dragRotate: false,
    canvasContextAttributes: { alpha: true }
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
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
  initMeasure(getMap);
  initFit(getMap);

  // Init globe background shader
  initGlobeBackground(map.getContainer());
  startGlobeBackground();
  map.on('render', () => { updateGlobeRadius(map); });

  map.on('movestart', () => { setMapIdle(false); });
  map.on('idle', () => { setMapIdle(true); });

  map.on('load', () => {
    addPhotoLayers();
    addSelectionLayer();
    addMeasureLayers();
    setupMarkerInteractions();
    setupRectangularSelection();

    updateMapData();
    if (savedView === null && state.filteredPhotos.length > 0) {
      fitToPhotos();
    }
  });

  map.on('projectiontransition', () => {
    if (map.getProjection().type === 'globe') {
      startGlobeBackground();
    } else {
      stopGlobeBackground();
    }
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

  setupPlacement(map, setMarkerVisibility);
}

function updateMapData() {
  const source = map.getSource('photos');
  if (source === undefined) return;

  const geojson = createGeoJSON();
  const geoSource = source as maplibregl.GeoJSONSource;
  geoSource.setData(geojson);

  // Re-cluster glow positions from new data
  syncGlowPositions();
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
    addMeasureLayers();
    setupMarkerInteractions();
    updateMapData();
  };

  void map.once('style.load', applyLayers);
  map.setStyle(withGlobe(style));
}

export function changeMarkerStyle(styleKey: string) {
  if (markerStyles[styleKey] === undefined) return;
  currentMarkerStyle = styleKey;
  if (map.getSource('photos') === undefined) return;
  stopPulseAnimation();
  addPhotoLayers();
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

const allPossibleLayers = [
  'photo-markers-highlight-ring',
  'photo-markers-selected',
  'photo-markers-highlight',
  'photo-markers',
  'photo-markers-shadow',
  'photo-glow'
];

const sortKey = [
  '-',
  ['*', -1000000, ['get', 'lat']],
  ['get', 'index']
] as maplibregl.ExpressionSpecification;

function syncGlowPositions() {
  if (currentGlowLayer === null) return;
  const positions: Array<{ lng: number; lat: number }> = [];
  for (const photo of state.filteredPhotos) {
    const { lon, lat } = getEffectiveCoords(photo);
    positions.push({ lng: lon, lat });
  }
  currentGlowLayer.updateData(positions);
}

function addPhotoLayers() {
  // Remove old glow custom layer
  if (currentGlowLayer !== null) {
    if (map.getLayer('photo-glow') !== undefined) map.removeLayer('photo-glow');
    currentGlowLayer = null;
    setGlowLayer(null);
  }

  for (const id of allPossibleLayers) {
    if (map.getLayer(id) !== undefined) map.removeLayer(id);
  }
  if (map.getSource('photos') !== undefined) map.removeSource('photos');

  map.addSource('photos', {
    type: 'geojson',
    data: createGeoJSON()
  });

  const config = markerStyles[currentMarkerStyle]!;
  const layers: string[] = [];

  // WebGL glow layer (custom clustering, no MapLibre source needed)
  if (config.glow !== undefined) {
    currentGlowLayer = new PhotoGlowLayer('photo-glow', config.glow);
    map.addLayer(currentGlowLayer);
    setGlowLayer(currentGlowLayer, map);
    layers.push('photo-glow');

    // Initial sync
    syncGlowPositions();
  }

  // Shadow layer (optional)
  if (config.shadow !== undefined) {
    map.addLayer({
      id: 'photo-markers-shadow',
      type: 'circle',
      source: 'photos',
      layout: { 'circle-sort-key': sortKey },
      paint: config.shadow
    });
    layers.push('photo-markers-shadow');
  }

  // Base markers
  map.addLayer({
    id: 'photo-markers',
    type: 'circle',
    source: 'photos',
    layout: { 'circle-sort-key': sortKey },
    paint: config.markerPaint
  });
  layers.push('photo-markers');

  // Points highlight layer (optional)
  if (config.highlight !== undefined) {
    map.addLayer({
      id: 'photo-markers-highlight',
      type: 'circle',
      source: 'photos',
      layout: { 'circle-sort-key': sortKey },
      paint: config.highlight
    });
    layers.push('photo-markers-highlight');
  }

  // Selected marker overlay
  map.addLayer({
    id: 'photo-markers-selected',
    type: 'circle',
    source: 'photos',
    paint: config.markerPaint,
    filter: ['==', ['get', 'index'], -1]
  });
  layers.push('photo-markers-selected');

  // Pulse ring
  map.addLayer({
    id: 'photo-markers-highlight-ring',
    type: 'circle',
    source: 'photos',
    paint: config.ring,
    filter: ['==', ['get', 'index'], -1]
  });
  layers.push('photo-markers-highlight-ring');

  markerLayers = layers;
}

let pulseAnimationId: number | null = null;

function startPulseAnimation() {
  if (pulseAnimationId !== null) return;
  const start = performance.now();
  const config = markerStyles[currentMarkerStyle]!;
  const animate = (now: number) => {
    const t = ((now - start) % 1200) / 1200;
    const { radius, opacity } = config.pulseRadius(map.getZoom(), t);
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
    if (isInPlacementMode()) return;

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
    if (!isInPlacementMode()) {
      map.getCanvas().style.cursor = 'pointer';
    }
  });
  map.on('mouseleave', 'photo-markers', () => {
    if (!isInPlacementMode()) {
      map.getCanvas().style.cursor = '';
    }
  });

  map.on('click', (e) => {
    // In placement mode, don't close popups on empty clicks
    if (isInPlacementMode()) return;

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

export { fitToPhotos };
export { selectGroupPhotoFromPopup as selectGroupPhoto };
