import {
  GlobeControl,
  Map as MapGL,
  NavigationControl,
  ScaleControl
} from 'maplibre-gl';
import type { MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';

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
import { initGpx } from './gpx';
import { initMeasure } from './measure';
import { createFlyToPopup, createPanToFitPopup } from './pan';
import {
  enterPlacementMode as enterPlacement,
  isInPlacementMode,
  setupPlacement
} from './placement';
import { PointsLayer } from './points-layer';
import { getPhotoUuid, getPopup, initPopupCallbacks, showPopup } from './popup';
import { initRoute } from './route';
import { initZAnchors } from './z-anchors';

// Global map variable (local to module)
// eslint-disable-next-line @typescript-eslint/init-declarations -- map is initialized in initMap() which is called before any other usage
let map: MapGL;

function showMapError(msg: string, onClick?: () => void) {
  let banner = document.getElementById('map-error-banner');
  if (banner === null) {
    banner = document.createElement('div');
    banner.id = 'map-error-banner';
    banner.style.cssText =
      'position:fixed;top:12px;left:50%;transform:translateX(-50%);' +
      'background:#dc2626;color:#fff;padding:8px 16px;border-radius:8px;' +
      'font:13px/1.4 -apple-system,sans-serif;z-index:99999;cursor:pointer;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.4)';
    document.body.appendChild(banner);
  }
  banner.textContent = msg;
  banner.onclick = () => {
    void navigator.clipboard.writeText(msg).then(() => {
      banner.textContent = 'Copied!';
      setTimeout(() => {
        banner.remove();
      }, 600);
    });
    if (onClick !== undefined) onClick();
  };
}

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
  changeMapStyle('satellite');
  fitToPhotos(true);
}

function applyGlobeProjection(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    projection: { type: 'globe' },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0 }
  };
}

function openExternalMap(target: 'apple' | 'google') {
  const c = map.getCenter();
  const z = Math.round(map.getZoom());
  const uuid = getPhotoUuid();
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
  const center: [number, number] | undefined =
    savedView === null ? undefined : [savedView.lon, savedView.lat];
  const zoom = savedView?.zoom;
  map = new MapGL({
    container: 'map',
    style: applyGlobeProjection(mapStyles().satellite as StyleSpecification),
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

  map.on('error', (e) => {
    console.error(
      '[MapGL] error:',
      (e.error as Error | undefined)?.message ?? e
    );
  });

  // Detect WebGL context loss — primary suspect for permanent map freeze
  const mapCanvas = map.getCanvas();
  mapCanvas.addEventListener('webglcontextlost', (e) => {
    console.error('[MapGL] WebGL context LOST', e);
    showMapError('WebGL context lost — map frozen');
  });
  mapCanvas.addEventListener('webglcontextrestored', () => {
    console.warn('[MapGL] WebGL context restored');
  });

  const panToFitPopup = createPanToFitPopup(map);
  const flyToPopup = createFlyToPopup(map);
  const highlight = (photo: Photo | null) => {
    currentLayer?.highlight(photo);
  };
  const getMarkerRadius = (zoom: number) =>
    currentLayer?.markerRadius(zoom) ?? 0;
  initZAnchors(map);
  initPopupCallbacks(map, {
    highlight,
    panToFitPopup,
    flyToPopup,
    getMarkerRadius
  });
  initMeasure(map, getMarkerLayerId);
  initRoute(map, getMarkerLayerId);
  initFit(map, savedView !== null);
  initGpx(map);
  initPhotoLayers(map);

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

  // Debug: track render loop health
  let renderFrames = 0;
  let lastRenderTs = 0;
  map.on('render', () => {
    renderFrames++;
    lastRenderTs = performance.now();
  });

  // Press Shift+D when frozen to see diagnostics
  document.addEventListener('keydown', (e) => {
    if (e.key === 'D' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const sinceRender = Math.round(performance.now() - lastRenderTs);
      const debugLog = (window as unknown as Record<string, string[]>)
        .__debugLog;
      const errors = debugLog?.slice(-5).join('\n') ?? '';
      const info = `Frames: ${renderFrames} | Last render: ${sinceRender}ms ago | Tiles loaded: ${String(map.areTilesLoaded())}`;
      showMapError(errors === '' ? info : `${info}\n${errors}`);
    }
  });

  // Background click dismisses an open popup unless the click hits a marker.
  // Independent of marker style, so registered once instead of via
  // setupMarkerInteractions (which re-binds on marker style swap).
  map.on('click', (e) => {
    if (isInPlacementMode()) return;
    const id = getMarkerLayerId();
    if (id !== null) {
      const features = map.queryRenderedFeatures(e.point, { layers: [id] });
      if (features.length > 0) return;
    }
    getPopup()?.remove();
  });

  map.on('projectiontransition', () => {
    if (map.getProjection().type === 'globe') {
      startGlobeBackground();
    } else {
      stopGlobeBackground();
    }
    const popup = getPopup();
    if (popup === null) return;
    const uuid = getPhotoUuid();
    if (uuid === null) return;
    const index = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
    if (index === -1) return;
    showPopup(index);
  });

  subscribe(() => {
    if (currentLayer === null) return;
    const uuid = getPhotoUuid();
    currentLayer.setMarkers(state.filteredPhotos);
    const popup = getPopup();
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

function reopenPopup() {
  const uuid = getPhotoUuid();
  if (uuid === null) return;
  const index = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
  if (index === -1) return;
  showPopup(index);
}

// Carry app-owned sources and layers across a basemap swap. App-owned =
// anything in previousStyle not declared by any basemap config. The
// next-basemap check guards against duplicate-ID crashes from auto-injected
// layers.
function transformStyle(
  previousStyle: StyleSpecification | undefined,
  nextStyle: StyleSpecification
): StyleSpecification {
  if (previousStyle === undefined) return nextStyle;

  const allBasemaps = Object.values(mapStyles()) as StyleSpecification[];
  const bmLayers = new Set(
    allBasemaps.flatMap((s) => s.layers.map((l) => l.id))
  );
  const bmSources = new Set(allBasemaps.flatMap((s) => Object.keys(s.sources)));
  const nextLayerIds = new Set(nextStyle.layers.map((l) => l.id));
  const nextSourceIds = new Set(Object.keys(nextStyle.sources));

  const appLayers = previousStyle.layers.filter(
    (l) => !bmLayers.has(l.id) && !nextLayerIds.has(l.id)
  );
  const appSources: typeof nextStyle.sources = {};
  for (const [id, src] of Object.entries(previousStyle.sources)) {
    if (!bmSources.has(id) && !nextSourceIds.has(id)) appSources[id] = src;
  }

  return {
    ...nextStyle,
    sources: { ...nextStyle.sources, ...appSources },
    layers: [...nextStyle.layers, ...appLayers]
  };
}

function changeMapStyle(styleKey: string) {
  const next = mapStyles()[styleKey as keyof MapStyles] as
    | StyleSpecification
    | undefined;
  if (next === undefined) return;

  // Stop any ongoing animation to prevent MapLibre crash during style change
  map.stop();

  map.setStyle(applyGlobeProjection(next), { transformStyle });
}

function changeMarkerStyle(styleKey: string) {
  if (!(styleKey in markerStyles)) return;
  currentMarkerStyle = styleKey;
  if (currentLayer === null) return;
  addPhotoLayers();
  setupMarkerInteractions();
  if (isInPlacementMode()) {
    currentLayer.toggle(false);
  } else {
    reopenPopup();
  }
}

function addPhotoLayers() {
  currentLayer?.uninstall();
  currentLayer = markerStyles[currentMarkerStyle]!();
  currentLayer.install(map, state.filteredPhotos);
}

function initPhotoLayers(m: MapGL) {
  m.on('load', () => {
    addPhotoLayers();
    setupMarkerInteractions();
  });
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

  map.on('click', layerId, onLayerClick);
  map.on('mouseenter', layerId, onMouseEnter);
  map.on('mouseleave', layerId, onMouseLeave);

  interactionCleanup = () => {
    map.off('click', layerId, onLayerClick);
    map.off('mouseenter', layerId, onMouseEnter);
    map.off('mouseleave', layerId, onMouseLeave);
  };
}
