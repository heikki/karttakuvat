import type { Point } from 'geojson';
import {
  GlobeControl,
  Map as MapGL,
  NavigationControl,
  ScaleControl
} from 'maplibre-gl';
import type {
  MapLayerMouseEvent,
  MapMouseEvent,
  StyleSpecification
} from 'maplibre-gl';

import { ClassicLayer } from './classic-layer';
import { mapStyles } from './config';
import { getEffectiveCoords, state, subscribe } from './data';
import { mapViewFromUrl, mapViewToUrl } from './filter-url';
import { fitToPhotos, initFit } from './fit';
import {
  initGlobeBackground,
  setGlobeRadius,
  setMapIdle,
  startGlobeBackground,
  stopGlobeBackground
} from './globe-background';
import { addMeasureLayers, initMeasure } from './measure';
import { createPanToFitPopup } from './pan';
import {
  enterPlacementMode as enterPlacement,
  isInPlacementMode,
  setupPlacement
} from './placement';
import { PointsLayer } from './points-layer';
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
import type { MapStyles, MarkerLayer, Photo } from './types';

// Declare window augmentation for map
declare global {
  interface Window {
    map?: MapGL;
  }
}

// Global map variable (local to module)
// eslint-disable-next-line @typescript-eslint/init-declarations -- map is initialized in initMap() which is called before any other usage
let map: MapGL;

export function getMap(): MapGL {
  return map;
}

const markerStyles: Record<string, () => MarkerLayer> = {
  points: () => new PointsLayer(),
  classic: () => new ClassicLayer()
};

let currentMarkerStyle = 'points';
let currentLayer: MarkerLayer | null = null;
let interactionCleanup: (() => void) | null = null;

function getMarkerLayerId(): string | null {
  return currentLayer?.id ?? null;
}

function setMarkerVisibility(visible: boolean) {
  currentLayer?.toggle(visible);
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
  map = new MapGL({
    container: 'map',
    style: withGlobe(mapStyles().satellite as StyleSpecification),
    center,
    zoom,
    minZoom: 1,
    boxZoom: false,
    keyboard: false,
    dragRotate: false,
    canvasContextAttributes: { alpha: true }
  });

  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new GlobeControl(), 'bottom-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

  map.on('moveend', () => {
    const c = map.getCenter();
    mapViewToUrl({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
  });

  map.on('error', () => {
    /* ignore */
  });
  window.map = map;

  const panToFitPopup = createPanToFitPopup(map);
  const highlight = (photo: Photo | null) => {
    currentLayer?.highlight(photo);
  };
  initPopupCallbacks(highlight, panToFitPopup, getMap);
  initSelectionCallbacks(getMap, getMarkerLayerId);
  initMeasure(getMap, getMarkerLayerId);
  initFit(getMap);

  // Init globe background shader
  initGlobeBackground(map.getContainer());
  startGlobeBackground();
  map.on('render', () => {
    if (map.getProjection().type !== 'globe') return;
    const { lat, lng } = map.getCenter();
    const centerPx = map.project([lng, lat]);
    const px = map.project([lng + 90, 0]);
    const dx = px.x - centerPx.x;
    const dy = px.y - centerPx.y;
    const canvas = map.getCanvas();
    setGlobeRadius(
      Math.sqrt(dx * dx + dy * dy),
      Math.min(canvas.clientWidth, canvas.clientHeight)
    );
  });

  map.on('movestart', () => {
    setMapIdle(false);
  });
  map.on('idle', () => {
    setMapIdle(true);
  });

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
    if (currentLayer === null) return;
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
  currentLayer?.setMarkers(state.filteredPhotos);
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
  if (!(styleKey in markerStyles)) return;
  currentMarkerStyle = styleKey;
  if (currentLayer === null) return;
  addPhotoLayers();
  setupMarkerInteractions();
  updateMapData();
}

function addPhotoLayers() {
  currentLayer?.uninstall();
  currentLayer = markerStyles[currentMarkerStyle]!();
  currentLayer.install(map);
}

function setupMarkerInteractions() {
  // Remove previous handlers before adding new ones
  if (interactionCleanup !== null) {
    interactionCleanup();
  }

  const layerId = currentLayer?.id;
  if (layerId === undefined) return;

  const onLayerClick = (e: MapLayerMouseEvent) => {
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
  };

  const onMouseEnter = () => {
    if (!isInPlacementMode()) {
      map.getCanvas().style.cursor = 'pointer';
    }
  };
  const onMouseLeave = () => {
    if (!isInPlacementMode()) {
      map.getCanvas().style.cursor = '';
    }
  };

  const onMapClick = (e: MapMouseEvent) => {
    // In placement mode, don't close popups on empty clicks
    if (isInPlacementMode()) return;

    const id = getMarkerLayerId();
    if (id !== null) {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [id]
      });
      if (features.length > 0) return;
    }
    const selectionFeatures = map.queryRenderedFeatures(e.point, {
      layers: ['selection-fill']
    });
    if (selectionFeatures.length > 0) return;
    const popup = getCurrentPopup();
    if (popup !== null) {
      popup.remove();
    }
  };

  map.on('click', layerId, onLayerClick);
  map.on('mouseenter', layerId, onMouseEnter);
  map.on('mouseleave', layerId, onMouseLeave);
  map.on('click', onMapClick);

  interactionCleanup = () => {
    map.off('click', layerId, onLayerClick);
    map.off('mouseenter', layerId, onMouseEnter);
    map.off('mouseleave', layerId, onMouseLeave);
    map.off('click', onMapClick);
  };
}

export { fitToPhotos };
export { selectGroupPhotoFromPopup as selectGroupPhoto };
