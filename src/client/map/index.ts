import {
  GlobeControl,
  Map as MapGL,
  NavigationControl,
  ScaleControl
} from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';

import * as edits from '@common/edits';
import { OpenExternalMapEvent, ResetMapEvent } from '@common/events';
import { mapViewFromUrl, mapViewToUrl } from '@common/filter-url';
import { effect } from '@common/signals';
import { viewState } from '@common/view-state';

import background from './background';
import config from './config';
import fit from './fit';
import gpx from './gpx';
import markers from './markers';
import measure from './measure';
import placement from './placement';
import popup from './popup';
import route from './route';
import selection from './selection';
import zAnchors from './z-anchors';

// Global map variable (local to module)
// eslint-disable-next-line @typescript-eslint/init-declarations -- map is initialized in init() which is called before any other usage
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

function resetMap() {
  selection.clear();
  viewState.mapStyle.set('satellite');
  fit.toPhotos(true);
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
  const photo = selection.getPhoto();
  const loc =
    photo === undefined
      ? undefined
      : (edits.getEffectiveLocation(photo) ?? undefined);

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

function init() {
  const savedView = mapViewFromUrl();
  const center: [number, number] | undefined =
    savedView === null ? undefined : [savedView.lon, savedView.lat];
  const zoom = savedView?.zoom;
  const initialStyleKey = viewState.mapStyle.get();
  const initialStyle =
    config.styles()[initialStyleKey] ?? config.styles().satellite!;
  let lastAppliedStyleKey: string = initialStyleKey;
  map = new MapGL({
    container: 'map',
    style: applyGlobeProjection(initialStyle),
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

  selection.init();
  zAnchors.init(map);
  popup.init(map);
  measure.init(map);
  route.init(map);
  fit.init(map);
  gpx.init(map);
  markers.init(map);

  // Init globe background shader
  background.init(map.getContainer());
  background.start();
  map.on('render', () => {
    if (map.getProjection().type !== 'globe') return;
    const { lat, lng } = map.getCenter();
    const centerPx = map.project([lng, lat]);
    const px = map.project([lng + 90, 0]);
    const dx = px.x - centerPx.x;
    const dy = px.y - centerPx.y;
    const canvas = map.getCanvas();
    background.setRadius(
      Math.sqrt(dx * dx + dy * dy),
      Math.min(canvas.clientWidth, canvas.clientHeight)
    );
  });

  map.on('movestart', () => {
    background.setIdle(false);
  });
  map.on('idle', () => {
    background.setIdle(true);
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

  map.on('click', (e) => {
    if (selection.getMode() === 'placement') return;
    if (e.defaultPrevented) return;
    if (selection.getMode() === 'popup') selection.clear();
  });

  map.on('projectiontransition', () => {
    if (map.getProjection().type === 'globe') {
      background.start();
    } else {
      background.stop();
    }
    const uuid = selection.getPhotoUuid();
    if (selection.getMode() !== 'popup' || uuid === null) return;
    // Force a popup remount so it re-anchors with the new projection.
    selection.clear();
    selection.openPopup(uuid);
  });

  placement.init(map);

  effect(() => {
    const next = viewState.mapStyle.get();
    if (next === lastAppliedStyleKey) return;
    lastAppliedStyleKey = next;
    changeMapStyle(next);
  });
  document.addEventListener(ResetMapEvent.type, () => {
    resetMap();
  });
  document.addEventListener(OpenExternalMapEvent.type, (e) => {
    openExternalMap(e.provider);
  });
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

  const allBasemaps = Object.values(config.styles());
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
  const next = config.styles()[styleKey];
  if (next === undefined) return;

  // Stop any ongoing animation to prevent MapLibre crash during style change
  map.stop();

  map.setStyle(applyGlobeProjection(next), { transformStyle });
}

export default { init };
