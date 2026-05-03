import turfDistance from '@turf/distance';
import { point } from '@turf/helpers';
import type { GeoJSONSource, Map as MapGL, MapMouseEvent } from 'maplibre-gl';

import { effect } from '@common/signals';

import mapUtils from './map-utils';
import selection from './selection';
import zAnchors from './z-anchors';

// eslint-disable-next-line @typescript-eslint/init-declarations -- initialized in init() before any usage
let map: MapGL;
const coords: Array<[number, number]> = [];

const POINT_SOURCE = 'measure-points';
const LINE_SOURCE = 'measure-line';
const POINT_LAYER = 'measure-points-layer';
const LINE_LAYER = 'measure-line-layer';

let overlay: HTMLElement | null = null;

function isActive(): boolean {
  return selection.interactionMode.get() === 'measure';
}

function init(m: MapGL) {
  map = m;
  addMeasureLayers();

  let wasActive = false;
  effect(() => {
    const active = isActive();
    if (active === wasActive) return;
    wasActive = active;
    if (active) onEnter();
    else onExit();
  });
}

function addMeasureLayers() {
  const before = zAnchors.id('measure');
  const visibility = isActive() ? 'visible' : 'none';

  map.addSource(POINT_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addSource(LINE_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  map.addLayer(
    {
      id: LINE_LAYER,
      type: 'line',
      source: LINE_SOURCE,
      paint: {
        'line-color': '#ff4444',
        'line-width': 2,
        'line-dasharray': [3, 2]
      },
      layout: { visibility }
    },
    before
  );

  map.addLayer(
    {
      id: POINT_LAYER,
      type: 'circle',
      source: POINT_SOURCE,
      paint: {
        'circle-radius': 6,
        'circle-color': '#ff4444',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff'
      },
      layout: { visibility }
    },
    before
  );
}

function updateSources() {
  const pointSource = map.getSource<GeoJSONSource>(POINT_SOURCE);
  if (pointSource !== undefined) {
    pointSource.setData({
      type: 'FeatureCollection',
      features: coords.map((c, i) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: c },
        properties: { index: i }
      }))
    });
  }

  const lineSource = map.getSource<GeoJSONSource>(LINE_SOURCE);
  if (lineSource !== undefined) {
    lineSource.setData(
      coords.length >= 2
        ? {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: {}
          }
        : { type: 'FeatureCollection', features: [] }
    );
  }

  updateOverlay();
}

function computeDistance(): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += turfDistance(point(coords[i - 1]!), point(coords[i]!), {
      units: 'kilometers'
    });
  }
  return total;
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

function ensureOverlay() {
  if (overlay !== null) return;
  overlay = document.createElement('div');
  overlay.className = 'measure-overlay';
  document.body.appendChild(overlay);
}

function updateOverlay() {
  if (overlay === null) return;
  if (coords.length < 2) {
    overlay.textContent =
      coords.length === 0
        ? 'Click map to add points'
        : 'Click to add more points';
    return;
  }
  const dist = computeDistance();
  overlay.textContent = formatDistance(dist);
}

function removeOverlay() {
  if (overlay !== null) {
    overlay.remove();
    overlay = null;
  }
}

function setLayerVisibility(visible: boolean) {
  mapUtils.setLayersVisibility(map, [POINT_LAYER, LINE_LAYER], visible);
}

function onMapClick(e: MapMouseEvent) {
  // Check if clicking on an existing measure point to remove it
  const features = map.queryRenderedFeatures(e.point, {
    layers: [POINT_LAYER]
  });
  if (features.length > 0) {
    const idx = features[0]!.properties.index as number;
    coords.splice(idx, 1);
    updateSources();
    return;
  }

  if (e.defaultPrevented) return;

  coords.push([e.lngLat.lng, e.lngLat.lat]);
  updateSources();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') selection.interactionMode.set('idle');
}

function onEnter() {
  coords.length = 0;
  map.getCanvas().classList.add('crosshair');
  setLayerVisibility(true);
  updateSources();
  ensureOverlay();
  updateOverlay();
  map.on('click', onMapClick);
  document.addEventListener('keydown', onKeyDown);
}

function onExit() {
  coords.length = 0;
  map.getCanvas().classList.remove('crosshair');
  updateSources();
  setLayerVisibility(false);
  removeOverlay();
  map.off('click', onMapClick);
  document.removeEventListener('keydown', onKeyDown);
}

function toggle() {
  selection.interactionMode.set(isActive() ? 'idle' : 'measure');
}

export default { init, toggle };
