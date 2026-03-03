import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { GeoJSONSource, Map as MapGL } from 'maplibre-gl';

import { state, subscribe } from '@common/data';
import { TogglePhotoRouteEvent } from '@common/events';
import { getEffectiveLocation } from '@common/photo-utils';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';

// Sources and layers
const SOURCE = 'photo-route';
const OUTLINE_LAYER = 'photo-route-outline';
const LINE_LAYER = 'photo-route-line';
const HIGHLIGHT_LAYER = 'photo-route-highlight';

const ALL_LAYERS = [OUTLINE_LAYER, LINE_LAYER, HIGHLIGHT_LAYER];

// Module state
let map: MapGL | null = null;
let visible = false;

export function initPhotoRoute(m: MapGL): void {
  map = m;

  document.addEventListener(TogglePhotoRouteEvent.type, (e) => {
    setPhotoRouteVisible(e.show);
  });

  // Rebuild route when filtered photos change
  subscribe(() => {
    if (visible) updateRoute();
  });
}

export function addPhotoRouteLayers(): void {
  if (map === null) return;

  // Clean up existing
  for (const id of ALL_LAYERS) {
    if (map.getLayer(id) !== undefined) map.removeLayer(id);
  }
  if (map.getSource(SOURCE) !== undefined) map.removeSource(SOURCE);

  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

  map.addSource(SOURCE, { type: 'geojson', data: empty });

  map.addLayer({
    id: OUTLINE_LAYER,
    type: 'line',
    source: SOURCE,
    paint: { 'line-color': 'rgba(0, 0, 0, 0.3)', 'line-width': 4 },
    layout: {
      'visibility': visible ? 'visible' : 'none',
      'line-cap': 'round',
      'line-join': 'round'
    }
  });

  map.addLayer({
    id: LINE_LAYER,
    type: 'line',
    source: SOURCE,
    paint: {
      'line-color': '#60a5fa',
      'line-width': 2,
      'line-dasharray': [6, 4]
    },
    layout: {
      'visibility': visible ? 'visible' : 'none',
      'line-cap': 'round',
      'line-join': 'round'
    }
  });

  map.addLayer({
    id: HIGHLIGHT_LAYER,
    type: 'line',
    source: SOURCE,
    paint: {
      'line-color': '#ffffff',
      'line-width': 2,
      'line-opacity': 0
    },
    layout: {
      'visibility': visible ? 'visible' : 'none',
      'line-cap': 'round',
      'line-join': 'round'
    }
  });

  if (visible) updateRoute();
}

export function setPhotoRouteVisible(show: boolean): void {
  visible = show;
  if (map === null) return;

  const vis = show ? 'visible' : 'none';
  for (const id of ALL_LAYERS) {
    if (map.getLayer(id) !== undefined) {
      map.setLayoutProperty(id, 'visibility', vis);
    }
  }

  if (show) {
    updateRoute();
  }
}

export function isPhotoRouteVisible(): boolean {
  return visible;
}

function updateRoute(): void {
  if (map === null) return;

  const src = map.getSource(SOURCE) as GeoJSONSource | undefined;
  if (src === undefined) return;

  const album = state.filters.album;
  if (album === 'all') {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  // Collect geolocated photos with UTC sort keys
  const located: Array<{ photo: Photo; loc: { lat: number; lon: number }; sortKey: string }> = [];
  for (const photo of state.filteredPhotos) {
    const loc = getEffectiveLocation(photo);
    if (loc === null) continue;
    if (photo.date === '') continue;
    located.push({
      photo,
      loc,
      sortKey: toUtcSortKey(photo.date, photo.tz)
    });
  }

  if (located.length < 2) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  // Sort by UTC time
  located.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  // Build LineString connecting all photos
  const coordinates: Array<[number, number]> = located.map((p) => [p.loc.lon, p.loc.lat]);

  const feature: Feature<LineString> = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: {}
  };

  const fc: FeatureCollection = {
    type: 'FeatureCollection',
    features: [feature]
  };

  src.setData(fc);
}
