import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { GeoJSONSource, Map as MapGL } from 'maplibre-gl';

import { state, subscribe } from '@common/data';
import { TogglePhotoRouteEvent } from '@common/events';
import { getEffectiveDate, getEffectiveLocation } from '@common/photo-utils';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';

import { setLayersVisibility } from './map-utils';
import { buildRouteLineFeatures } from './route-edit-helpers';

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

  setLayersVisibility(map, ALL_ROUTE_LAYERS, show);

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
  setLayersVisibility(map, ALL_ROUTE_LAYERS, !editing && visible);
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
      sortKey: toUtcSortKey(getEffectiveDate(photo), photo.tz)
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
  const src = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
  if (src === undefined) return;

  const features = buildRouteLineFeatures(data);
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

function makeStraightSegment(from: RoutePoint, to: RoutePoint): RouteSegment {
  return {
    method: 'straight',
    geometry: [
      [from.lon, from.lat],
      [to.lon, to.lat]
    ]
  };
}

function buildPhotoSortKeys(): Map<string, string> {
  const m = new Map<string, string>();
  for (const photo of state.filteredPhotos) {
    if (photo.date !== '') {
      m.set(photo.uuid, toUtcSortKey(getEffectiveDate(photo), photo.tz));
    }
  }
  return m;
}

function collectSortablePhotoIndices(
  points: RoutePoint[],
  sortKeys: Map<string, string>
): number[] {
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    if (pt.type === 'photo' && pt.uuid !== undefined && sortKeys.has(pt.uuid)) {
      indices.push(i);
    }
  }
  return indices;
}

function computeSortedUuids(
  currentUuids: string[],
  sortKeys: Map<string, string>
): string[] {
  return [...currentUuids].sort((a, b) => {
    const ka = sortKeys.get(a)!;
    const kb = sortKeys.get(b)!;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function snapshotPointsByUuid(
  points: RoutePoint[],
  indices: number[]
): Map<string, RoutePoint> {
  const m = new Map<string, RoutePoint>();
  for (const i of indices) {
    const pt = points[i]!;
    m.set(pt.uuid!, { ...pt });
  }
  return m;
}

function resetSegmentsAroundIndex(
  data: RouteData,
  idx: number,
  pt: RoutePoint
): void {
  const { points, segments } = data;
  if (idx > 0 && idx - 1 < segments.length) {
    segments[idx - 1] = makeStraightSegment(points[idx - 1]!, pt);
  }
  const next = points[idx + 1];
  if (idx < segments.length && next !== undefined) {
    segments[idx] = makeStraightSegment(pt, next);
  }
}

/** Remove waypoint at index k, merging the surrounding segments. */
function removeWaypointAt(data: RouteData, k: number): void {
  const { points, segments } = data;
  if (k === points.length - 1) {
    points.splice(k, 1);
    segments.splice(k - 1, 1);
    return;
  }
  points.splice(k, 1);
  segments.splice(k, 1);
  if (k > 0) {
    segments[k - 1] = makeStraightSegment(points[k - 1]!, points[k]!);
  }
}

/**
 * Splice waypoints immediately adjacent to the point at idx. Used after a
 * photo's coordinate changes (relocate or chronological reorder) to discard
 * waypoints that are likely stale. Returns the new index of the original
 * point (decremented if a preceding waypoint was removed) and whether any
 * waypoint was removed.
 */
function removeAdjacentWaypoints(
  data: RouteData,
  idx: number
): { idx: number; removed: boolean } {
  const { points } = data;
  let cur = idx;
  let removed = false;
  if (cur + 1 < points.length && points[cur + 1]!.type === 'waypoint') {
    removeWaypointAt(data, cur + 1);
    removed = true;
  }
  if (cur > 0 && points[cur - 1]!.type === 'waypoint') {
    removeWaypointAt(data, cur - 1);
    cur -= 1;
    removed = true;
  }
  return { idx: cur, removed };
}

/**
 * Reorder photo points in route data to match current chronological order.
 * Segments adjacent to moved points are reset to straight-line, and waypoints
 * adjacent to moved points are spliced (likely stale after the swap).
 * Returns true if any reordering occurred.
 */
function reorderRoutePhotoPoints(data: RouteData): boolean {
  const sortKeys = buildPhotoSortKeys();
  const { points } = data;
  const photoIndices = collectSortablePhotoIndices(points, sortKeys);
  if (photoIndices.length < 2) return false;

  const currentUuids = photoIndices.map((i) => points[i]!.uuid!);
  const sortedUuids = computeSortedUuids(currentUuids, sortKeys);
  if (currentUuids.every((uuid, i) => uuid === sortedUuids[i])) return false;

  const uuidToPoint = snapshotPointsByUuid(points, photoIndices);

  const movedIndices: number[] = [];
  for (let i = 0; i < photoIndices.length; i++) {
    const idx = photoIndices[i]!;
    if (currentUuids[i] === sortedUuids[i]) continue;
    const newPt = { ...uuidToPoint.get(sortedUuids[i]!)! };
    points[idx] = newPt;
    resetSegmentsAroundIndex(data, idx, newPt);
    movedIndices.push(idx);
  }

  // Drop adjacent waypoints back-to-front so splices don't shift unvisited indices
  for (let i = movedIndices.length - 1; i >= 0; i--) {
    removeAdjacentWaypoints(data, movedIndices[i]!);
  }

  return true;
}

/**
 * Sync photo point coordinates in route data with current effective locations.
 * When a photo's coord changes, splice any waypoint immediately before or
 * after it (likely stale). Returns true if any waypoint was removed.
 */
export function syncPhotoPoints(data: RouteData): boolean {
  const locMap = buildPhotoLocationMap();
  const { points, segments } = data;
  let removed = false;
  let i = 0;
  while (i < points.length) {
    const loc = getMovedPhotoLocation(points[i]!, locMap);
    if (loc === null) {
      i++;
      continue;
    }
    const pt = points[i]!;
    pt.lon = loc.lon;
    pt.lat = loc.lat;
    const coord: [number, number] = [loc.lon, loc.lat];
    const before = segments[i - 1];
    if (before !== undefined) {
      if (before.method === 'straight') {
        before.geometry.splice(-1, 1, coord);
      } else {
        const prev = points[i - 1]!;
        segments[i - 1] = {
          method: 'straight',
          geometry: [[prev.lon, prev.lat], coord]
        };
      }
    }
    const after = segments[i];
    if (after !== undefined) {
      if (after.method === 'straight') {
        after.geometry.splice(0, 1, coord);
      } else {
        const next = points[i + 1]!;
        segments[i] = {
          method: 'straight',
          geometry: [coord, [next.lon, next.lat]]
        };
      }
    }
    const result = removeAdjacentWaypoints(data, i);
    if (result.removed) removed = true;
    i = result.idx + 1;
  }
  return removed;
}

function updateRoute(): void {
  if (map === null) return;

  const src = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
  if (src === undefined) return;

  // Use saved route data if available, syncing photo locations and order
  if (savedRouteData !== null) {
    const synced = syncPhotoPoints(savedRouteData);
    const reordered = reorderRoutePhotoPoints(savedRouteData);
    applyRouteData(savedRouteData);
    // Persist changes only when no pending edits (committed state)
    if ((synced || reordered) && state.pendingTimeEdits.size === 0) {
      const album = state.filters.album;
      if (album !== 'all') void saveRoute(album, savedRouteData);
    }
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
