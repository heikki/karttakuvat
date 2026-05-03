import type { GeoJSONSource, Map as MapGL, MapMouseEvent } from 'maplibre-gl';

import {
  MeasureModeExitedEvent,
  ResetMapEvent,
  ToggleMeasureModeEvent
} from '@common/events';

import { computePathDistance, setLayersVisibility } from './map-utils';
import { anchorId } from './z-anchors';

// eslint-disable-next-line @typescript-eslint/init-declarations -- initialized in initMeasure() before any usage
let map: MapGL;
let isMeasureActive = false;
const coords: Array<[number, number]> = [];

const POINT_SOURCE = 'measure-points';
const LINE_SOURCE = 'measure-line';
const POINT_LAYER = 'measure-points-layer';
const LINE_LAYER = 'measure-line-layer';

let overlay: HTMLElement | null = null;

export function isMeasureMode(): boolean {
  return isMeasureActive;
}

export function initMeasure(m: MapGL) {
  map = m;
  m.on('load', addMeasureLayers);
  document.addEventListener(ToggleMeasureModeEvent.type, () => {
    toggleMeasureMode();
  });
  document.addEventListener(ResetMapEvent.type, () => {
    exitMeasureMode();
  });
}

function addMeasureLayers() {
  const before = anchorId('measure');

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
      layout: {
        visibility: isMeasureActive ? 'visible' : 'none'
      }
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
      layout: {
        visibility: isMeasureActive ? 'visible' : 'none'
      }
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
  return computePathDistance(coords);
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
  setLayersVisibility(map, [POINT_LAYER, LINE_LAYER], visible);
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
  if (e.key === 'Escape') {
    exitMeasureMode();
  }
}

function enterMeasureMode() {
  if (isMeasureActive) return;
  isMeasureActive = true;
  coords.length = 0;

  map.getCanvas().classList.add('crosshair');
  setLayerVisibility(true);
  updateSources();

  ensureOverlay();
  updateOverlay();

  map.on('click', onMapClick);
  document.addEventListener('keydown', onKeyDown);
}

function exitMeasureMode() {
  if (!isMeasureActive) return;
  isMeasureActive = false;
  coords.length = 0;

  map.getCanvas().classList.remove('crosshair');
  updateSources();
  setLayerVisibility(false);
  removeOverlay();

  map.off('click', onMapClick);
  document.removeEventListener('keydown', onKeyDown);

  document.dispatchEvent(new MeasureModeExitedEvent());
}

export function toggleMeasureMode() {
  if (isMeasureActive) {
    exitMeasureMode();
  } else {
    enterMeasureMode();
  }
}
