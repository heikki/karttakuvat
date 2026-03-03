import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { GeoJSONSource, Map as MapGL } from 'maplibre-gl';

import { state, subscribe } from '@common/data';
import { TogglePhotoRouteEvent } from '@common/events';
import { getEffectiveLocation } from '@common/photo-utils';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';

// Types for route data
export interface RoutePoint {
  type: 'photo' | 'waypoint';
  uuid?: string;
  lon: number;
  lat: number;
}

export interface RouteSegment {
  method: 'straight' | 'driving' | 'walking' | 'hiking' | 'cycling';
  geometry: Array<[number, number]>;
}

export interface RouteData {
  points: RoutePoint[];
  segments: RouteSegment[];
}

// Sources and layers
export const ROUTE_SOURCE = 'photo-route';
const OUTLINE_LAYER = 'photo-route-outline';
const LINE_LAYER = 'photo-route-line';
const HIGHLIGHT_LAYER = 'photo-route-highlight';

export const ALL_ROUTE_LAYERS = [OUTLINE_LAYER, LINE_LAYER, HIGHLIGHT_LAYER];

// Module state
let map: MapGL | null = null;
let visible = false;
let savedRouteData: RouteData | null = null;

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
  for (const id of ALL_ROUTE_LAYERS) {
    if (map.getLayer(id) !== undefined) map.removeLayer(id);
  }
  if (map.getSource(ROUTE_SOURCE) !== undefined) map.removeSource(ROUTE_SOURCE);

  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: empty });

  map.addLayer({
    id: OUTLINE_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
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
    source: ROUTE_SOURCE,
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
    source: ROUTE_SOURCE,
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
  for (const id of ALL_ROUTE_LAYERS) {
    if (map.getLayer(id) !== undefined) {
      map.setLayoutProperty(id, 'visibility', vis);
    }
  }

  if (show) {
    // Try to load saved route
    const album = state.filters.album;
    if (album === 'all') {
      updateRoute();
    } else {
      void loadSavedRoute(album).then((data) => {
        if (data === null) {
          updateRoute();
        } else {
          savedRouteData = data;
          applyRouteData(data);
        }
      });
    }
  } else {
    savedRouteData = null;
  }
}

export function isPhotoRouteVisible(): boolean {
  return visible;
}

/** Hide/show the default route layers during edit mode. */
export function setRouteEditStyle(editing: boolean): void {
  if (map === null) return;
  const v = editing ? 'none' : visible ? 'visible' : 'none';
  for (const id of ALL_ROUTE_LAYERS) {
    if (map.getLayer(id) !== undefined) {
      map.setLayoutProperty(id, 'visibility', v);
    }
  }
}

/** Get the current saved route data (if any). */
export function getSavedRouteData(): RouteData | null {
  return savedRouteData;
}

/** Set route data from external source (route-edit) and update display. */
export function setRouteData(data: RouteData | null): void {
  savedRouteData = data;
  if (data === null) {
    updateRoute();
  } else {
    applyRouteData(data);
  }
}

/** Update saved route data reference without updating display layers. */
export function setSavedRouteData(data: RouteData | null): void {
  savedRouteData = data;
}

/** Build the default straight-line route from current filtered photos. */
export function buildDefaultRoute(): RouteData | null {
  const located = getSortedLocatedPhotos();
  if (located.length < 2) return null;

  const points: RoutePoint[] = located.map((p) => ({
    type: 'photo' as const,
    uuid: p.photo.uuid,
    lon: p.loc.lon,
    lat: p.loc.lat
  }));

  const segments: RouteSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      method: 'straight',
      geometry: [
        [points[i]!.lon, points[i]!.lat],
        [points[i + 1]!.lon, points[i + 1]!.lat]
      ]
    });
  }

  return { points, segments };
}

/** Load saved route from server. */
export async function loadSavedRoute(album: string): Promise<RouteData | null> {
  try {
    const resp = await fetch(`/api/albums/${encodeURIComponent(album)}/route`);
    if (!resp.ok) return null;
    return (await resp.json()) as RouteData;
  } catch {
    return null;
  }
}

/** Save route to server. */
export async function saveRoute(album: string, data: RouteData): Promise<void> {
  await fetch(`/api/albums/${encodeURIComponent(album)}/route`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

/** Delete saved route from server. */
export async function deleteRoute(album: string): Promise<void> {
  await fetch(`/api/albums/${encodeURIComponent(album)}/route`, {
    method: 'DELETE'
  });
}

function getSortedLocatedPhotos(): Array<{
  photo: Photo;
  loc: { lat: number; lon: number };
  sortKey: string;
}> {
  const located: Array<{
    photo: Photo;
    loc: { lat: number; lon: number };
    sortKey: string;
  }> = [];
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
  located.sort((a, b) =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
  );
  return located;
}

/** Apply RouteData to the display source. */
function applyRouteData(data: RouteData): void {
  if (map === null) return;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- getSource returns Source, need GeoJSONSource for setData
  const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
  if (src === undefined) return;

  // Concatenate all segment geometries into one LineString
  const allCoords: Array<[number, number]> = [];
  for (const seg of data.segments) {
    for (let i = 0; i < seg.geometry.length; i++) {
      // Skip first point of subsequent segments to avoid duplicates
      if (allCoords.length > 0 && i === 0) continue;
      allCoords.push(seg.geometry[i]!);
    }
  }

  if (allCoords.length < 2) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const feature: Feature<LineString> = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: allCoords },
    properties: {}
  };

  src.setData({ type: 'FeatureCollection', features: [feature] });
}

function updateRoute(): void {
  if (map === null) return;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- getSource returns Source, need GeoJSONSource for setData
  const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
  if (src === undefined) return;

  // Use saved route data if available
  if (savedRouteData !== null) {
    applyRouteData(savedRouteData);
    return;
  }

  const album = state.filters.album;
  if (album === 'all') {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const located = getSortedLocatedPhotos();

  if (located.length < 2) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }

  const coordinates: Array<[number, number]> = located.map((p) => [
    p.loc.lon,
    p.loc.lat
  ]);

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
