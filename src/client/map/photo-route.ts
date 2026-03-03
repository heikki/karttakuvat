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
  method: 'straight' | 'driving' | 'walking' | 'hiking' | 'cycling' | 'none';
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
let currentAlbum = 'all';

export function initPhotoRoute(m: MapGL): void {
  map = m;

  document.addEventListener(TogglePhotoRouteEvent.type, (e) => {
    setPhotoRouteVisible(e.show);
  });

  // Rebuild route when filtered photos change
  subscribe(() => {
    if (visible) onPhotosChanged();
  });
}

function onPhotosChanged(): void {
  const album = state.filters.album;
  if (album === currentAlbum) {
    updateRoute();
    return;
  }
  // Album changed — clear old route data and reload for new album
  currentAlbum = album;
  savedRouteData = null;
  if (album === 'all') {
    updateRoute();
    return;
  }
  void loadSavedRoute(album).then((data) => {
    if (state.filters.album !== album || !visible) return;
    if (data === null) {
      updateRoute();
      return;
    }
    syncPhotoPoints(data);
    savedRouteData = data;
    applyRouteData(data);
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
      'line-width': 2
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
    currentAlbum = album;
    if (album === 'all') {
      updateRoute();
    } else {
      void loadSavedRoute(album).then((data) => {
        if (data === null) {
          updateRoute();
        } else {
          syncPhotoPoints(data);
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

  // Build separate LineStrings, breaking at 'none' segments
  const features: Array<Feature<LineString>> = [];
  let current: Array<[number, number]> = [];
  for (const seg of data.segments) {
    if (seg.method === 'none') {
      if (current.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: current },
          properties: {}
        });
      }
      current = [];
      continue;
    }
    for (let i = 0; i < seg.geometry.length; i++) {
      if (current.length > 0 && i === 0) continue;
      current.push(seg.geometry[i]!);
    }
  }
  if (current.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: current },
      properties: {}
    });
  }

  src.setData({ type: 'FeatureCollection', features });
}

/** Build a lookup from uuid → effective location for all filtered photos. */
function buildPhotoLocationMap(): Map<string, { lon: number; lat: number }> {
  const m = new Map<string, { lon: number; lat: number }>();
  for (const photo of state.filteredPhotos) {
    const loc = getEffectiveLocation(photo);
    if (loc !== null) m.set(photo.uuid, loc);
  }
  return m;
}

function getMovedPhotoLocation(
  pt: RoutePoint,
  locMap: Map<string, { lon: number; lat: number }>
): { lon: number; lat: number } | null {
  if (pt.type !== 'photo' || pt.uuid === undefined) return null;
  const loc = locMap.get(pt.uuid);
  if (loc === undefined || (loc.lon === pt.lon && loc.lat === pt.lat)) {
    return null;
  }
  return loc;
}

/** Sync photo point coordinates in route data with current effective locations. */
export function syncPhotoPoints(data: RouteData): void {
  const locMap = buildPhotoLocationMap();
  for (let i = 0; i < data.points.length; i++) {
    const loc = getMovedPhotoLocation(data.points[i]!, locMap);
    if (loc === null) continue;
    const pt = data.points[i]!;
    pt.lon = loc.lon;
    pt.lat = loc.lat;
    const coord: [number, number] = [loc.lon, loc.lat];
    const before = data.segments[i - 1];
    if (before?.method === 'straight') before.geometry.splice(-1, 1, coord);
    const after = data.segments[i];
    if (after?.method === 'straight') after.geometry.splice(0, 1, coord);
  }
}

function updateRoute(): void {
  if (map === null) return;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- getSource returns Source, need GeoJSONSource for setData
  const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
  if (src === undefined) return;

  // Use saved route data if available, syncing photo locations
  if (savedRouteData !== null) {
    syncPhotoPoints(savedRouteData);
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
