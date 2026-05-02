import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapGL } from 'maplibre-gl';

import { state, subscribe } from '@common/data';
import {
  ResetMapEvent,
  RouteEditModeEvent,
  RouteVisibilityEvent
} from '@common/events';
import { getEffectiveDate, getEffectiveLocation } from '@common/photo-utils';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';

import { setLayersVisibility } from '../map-utils';
import { addRouteEditLayers, exitRouteEdit, initRouteEdit } from './edit';
import { buildRouteLineFeatures } from './helpers';
import {
  reconcileRouteWithAlbum,
  reorderRoutePhotoPoints,
  syncPhotoPoints
} from './reconcile';

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
const ROUTE_SOURCE = 'photo-route';
const OUTLINE_LAYER = 'photo-route-outline';
const LINE_LAYER = 'photo-route-line';

const ALL_ROUTE_LAYERS = [OUTLINE_LAYER, LINE_LAYER];

// Module state
let map: MapGL | null = null;
let visible = false;
let routeData: RouteData | null = null;
let currentAlbum = 'all';

/** Initialise the route subsystem. Called once at map creation. */
export function initRoute(
  m: MapGL,
  getMarkerLayerId: () => string | null
): void {
  initRouteEdit(m, getMarkerLayerId);
  initPhotoRoute(m);
  document.addEventListener(ResetMapEvent.type, () => {
    exitRouteEdit();
  });
}

/** Add all route sources and layers. Called on map style load. */
export function addRouteLayers(): void {
  addPhotoRouteLayers();
  addRouteEditLayers();
}

function initPhotoRoute(m: MapGL): void {
  map = m;

  document.addEventListener(RouteVisibilityEvent.type, (e) => {
    setPhotoRouteVisible(e.visible);
  });

  // Hide display layers while edit mode is active so edit owns rendering.
  document.addEventListener(RouteEditModeEvent.type, (e) => {
    if (map === null) return;
    setLayersVisibility(map, ALL_ROUTE_LAYERS, !e.active && visible);
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
  routeData = null;
  if (album === 'all') {
    updateRoute();
    return;
  }
  void loadAndApplyRoute(album);
}

/**
 * Reconcile route data against current album membership/locations/dates,
 * apply to the display source, and persist if structure changed and no
 * edits are pending.
 */
function reconcileAndApply(album: string, data: RouteData): void {
  const albumPhotos = state.photos.filter((p) => p.albums.includes(album));
  const changed = reconcileRouteWithAlbum(data, albumPhotos);
  routeData = data;
  applyRouteData(data);
  if (
    changed &&
    state.pendingEdits.size === 0 &&
    state.pendingTimeEdits.size === 0
  ) {
    void saveRoute(album, data);
  }
}

/** Load the saved route for an album (if any) and apply it. */
async function loadAndApplyRoute(album: string): Promise<void> {
  const data = await loadSavedRoute(album);
  if (state.filters.album !== album || !visible) return;
  if (data === null) {
    updateRoute();
    return;
  }
  reconcileAndApply(album, data);
}

function addPhotoRouteLayers(): void {
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

  if (visible) updateRoute();
}

function setPhotoRouteVisible(show: boolean): void {
  visible = show;
  if (map === null) return;

  setLayersVisibility(map, ALL_ROUTE_LAYERS, show);

  if (!show) return;

  const album = state.filters.album;
  if (album !== currentAlbum) {
    currentAlbum = album;
    routeData = null;
  }
  if (album === 'all') {
    updateRoute();
    return;
  }
  if (routeData !== null) {
    reconcileAndApply(album, routeData);
    return;
  }
  void loadAndApplyRoute(album);
}

/** Get the current route data (if any). */
export function getRouteData(): RouteData | null {
  return routeData;
}

/** Set route data and refresh the display source. */
export function setRouteData(data: RouteData | null): void {
  routeData = data;
  if (data === null) {
    updateRoute();
  } else {
    applyRouteData(data);
  }
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
async function loadSavedRoute(album: string): Promise<RouteData | null> {
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

function refreshSavedRoute(data: RouteData): void {
  const synced = syncPhotoPoints(data);
  const reordered = reorderRoutePhotoPoints(data);
  applyRouteData(data);
  if (!synced && !reordered) return;
  if (state.pendingEdits.size > 0 || state.pendingTimeEdits.size > 0) return;
  const album = state.filters.album;
  if (album !== 'all') void saveRoute(album, data);
}

function updateRoute(): void {
  if (map === null) return;

  const src = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
  if (src === undefined) return;

  if (routeData !== null) {
    refreshSavedRoute(routeData);
    return;
  }

  const album = state.filters.album;
  const data = album === 'all' ? null : buildDefaultRoute();
  if (data === null) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  applyRouteData(data);
}
