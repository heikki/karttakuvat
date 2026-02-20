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

import { state, subscribe } from '@common/data';
import {
  ChangeMapStyleEvent,
  ChangeMarkerStyleEvent,
  EnterPlacementEvent,
  OpenExternalMapEvent,
  ResetMapEvent
} from '@common/events';
import { mapViewFromUrl, mapViewToUrl } from '@common/filter-url';
import { getEffectiveLocation } from '@common/photo-utils';
import type { MapStyles, MarkerLayer, Photo } from '@common/types';

import {
  initGlobeBackground,
  setGlobeRadius,
  setMapIdle,
  startGlobeBackground,
  stopGlobeBackground
} from './background';
import { ClassicLayer } from './classic-layer';
import { mapStyles } from './config';
import { fitToPhotos, initFit } from './fit';
import { addGpxLayers, initGpx } from './gpx';
import {
  addMeasureLayers,
  exitMeasureMode,
  initMeasure,
  isMeasureMode
} from './measure';
import { createPanToFitPopup } from './pan';
import {
  enterPlacementMode as enterPlacement,
  isInPlacementMode,
  setupPlacement
} from './placement';
import { PointsLayer } from './points-layer';
import {
  getCurrentPhotoUuid,
  getCurrentPopup,
  initPopupCallbacks,
  reopenPopupFromUrl,
  showPopup
} from './popup';

// Global map variable (local to module)
// eslint-disable-next-line @typescript-eslint/init-declarations -- map is initialized in initMap() which is called before any other usage
let map: MapGL;

const markerStyles: Record<string, () => MarkerLayer> = {
  points: () => new PointsLayer(),
  classic: () => new ClassicLayer()
};

let currentMarkerStyle = 'classic';
let currentLayer: MarkerLayer | null = null;
let interactionCleanup: (() => void) | null = null;

function getMarkerLayerId(): string | null {
  return currentLayer?.id ?? null;
}

function setMarkerVisibility(visible: boolean) {
  currentLayer?.toggle(visible);
}

function resetMap() {
  getCurrentPopup()?.remove();
  if (isMeasureMode()) exitMeasureMode();
  changeMapStyle('satellite');
  fitToPhotos(true);
}

function withGlobe(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    projection: { type: 'globe' },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0 }
  };
}

function openExternalMap(target: 'apple' | 'google') {
  const c = map.getCenter();
  const z = Math.round(map.getZoom());
  const uuid = getCurrentPhotoUuid();
  const photo =
    uuid === null
      ? undefined
      : state.filteredPhotos.find((p) => p.uuid === uuid);
  const loc =
    photo === undefined
      ? undefined
      : (getEffectiveLocation(photo) ?? undefined);

  if (target === 'apple') {
    const url =
      loc === undefined
        ? `maps://?ll=${c.lat},${c.lng}&z=${z}&t=k`
        : `maps://?ll=${loc.lat},${loc.lon}&q=${loc.lat},${loc.lon}&z=${z}&t=k`;
    window.open(url, '_blank');
  } else {
    const url =
      loc === undefined
        ? `https://www.google.com/maps/@${c.lat},${c.lng},${z}z`
        : `https://www.google.com/maps?q=${loc.lat},${loc.lon}&z=${z}`;
    window.open(url, '_blank');
  }
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
    doubleClickZoom: false,
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
  const panToFitPopup = createPanToFitPopup(map);
  const highlight = (photo: Photo | null) => {
    currentLayer?.highlight(photo);
  };
  const getMarkerRadius = (zoom: number) =>
    currentLayer?.markerRadius(zoom) ?? 0;
  initPopupCallbacks(map, highlight, panToFitPopup, getMarkerRadius);
  initMeasure(map, getMarkerLayerId);
  initFit(map);
  initGpx(map);

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
    addGpxLayers();
    addPhotoLayers();
    addMeasureLayers();
    setupMarkerInteractions();

    updateMapData();
    reopenPopupFromUrl();
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
    showPopup(index);
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
          showPopup(newIndex);
          return;
        }
      }
      popup.remove();
    }
  });

  setupPlacement(map, setMarkerVisibility);

  document.addEventListener(EnterPlacementEvent.type, (e) => {
    enterPlacement(map, e.index);
  });
  document.addEventListener(ChangeMapStyleEvent.type, (e) => {
    changeMapStyle(e.style);
  });
  document.addEventListener(ChangeMarkerStyleEvent.type, (e) => {
    changeMarkerStyle(e.style);
  });
  document.addEventListener(ResetMapEvent.type, () => {
    resetMap();
  });
  document.addEventListener(OpenExternalMapEvent.type, (e) => {
    openExternalMap(e.provider);
  });
}

function updateMapData() {
  currentLayer?.setMarkers(state.filteredPhotos);
}

function restoreHighlight() {
  const uuid = getCurrentPhotoUuid();
  if (uuid === null) return;
  const index = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
  if (index === -1) return;
  showPopup(index);
}

function changeMapStyle(styleKey: string) {
  const style = mapStyles()[styleKey as keyof MapStyles] as
    | StyleSpecification
    | undefined;
  if (style === undefined) return;

  // Stop any ongoing animation to prevent MapLibre crash during style change
  map.stop();

  const applyLayers = () => {
    addGpxLayers();
    addPhotoLayers();
    addMeasureLayers();
    setupMarkerInteractions();
    updateMapData();
    if (isInPlacementMode()) {
      currentLayer?.toggle(false);
    } else {
      restoreHighlight();
    }
  };

  void map.once('style.load', applyLayers);
  map.setStyle(withGlobe(style));
}

function changeMarkerStyle(styleKey: string) {
  if (!(styleKey in markerStyles)) return;
  currentMarkerStyle = styleKey;
  if (currentLayer === null) return;
  addPhotoLayers();
  setupMarkerInteractions();
  updateMapData();
  if (isInPlacementMode()) {
    currentLayer.toggle(false);
  } else {
    restoreHighlight();
  }
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

    if (clickedIndex === undefined) return;
    showPopup(clickedIndex);
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
