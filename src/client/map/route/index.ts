import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapGL } from 'maplibre-gl';

import * as data from '@common/data';
import * as edits from '@common/edits';
import {
  ResetMapEvent,
  RouteEditModeChangedEvent,
  SetRouteVisibilityEvent
} from '@common/events';
import { effect } from '@common/signals';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';

import mapUtils from '../map-utils';
import zAnchors from '../z-anchors';
import { exitRouteEdit, initRouteEdit } from './edit';
import { buildRouteLineFeatures, createEditLayers } from './helpers';
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
function init(m: MapGL): void {
  initRouteEdit(m);
  initPhotoRoute(m);
  m.on('load', () => {
    addPhotoRouteLayers();
    createEditLayers(m);
  });
  document.addEventListener(ResetMapEvent.type, () => {
    exitRouteEdit();
  });
}

function initPhotoRoute(m: MapGL): void {
  map = m;

  document.addEventListener(SetRouteVisibilityEvent.type, (e) => {
    setPhotoRouteVisible(e.visible);
  });

  // Hide display layers while edit mode is active so edit owns rendering.
  document.addEventListener(RouteEditModeChangedEvent.type, (e) => {
    if (map === null) return;
    mapUtils.setLayersVisibility(map, ALL_ROUTE_LAYERS, !e.active && visible);
  });

  // Rebuild route when filtered photos OR pending edits change.
  const onChange = () => {
    if (visible) onPhotosChanged();
  };
  effect(() => {
    data.filteredPhotos.get();
    onChange();
  });
  edits.subscribe(onChange);
}

function onPhotosChanged(): void {
  const album = data.filters.get().album;
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
function reconcileAndApply(album: string, route: RouteData): void {
  const albumPhotos = data.photos.get().filter((p) => p.albums.includes(album));
  const changed = reconcileRouteWithAlbum(route, albumPhotos);
  routeData = route;
  applyRouteData(route);
  if (changed && edits.getCount() === 0) {
    void save(album, route);
  }
}

/** Load the saved route for an album (if any) and apply it. */
async function loadAndApplyRoute(album: string): Promise<void> {
  const route = await loadSavedRoute(album);
  if (data.filters.get().album !== album || !visible) return;
  if (route === null) {
    updateRoute();
    return;
  }
  reconcileAndApply(album, route);
}

function addPhotoRouteLayers(): void {
  if (map === null) return;

  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: empty });

  const before = zAnchors.id('route');

  map.addLayer(
    {
      id: OUTLINE_LAYER,
      type: 'line',
      source: ROUTE_SOURCE,
      paint: { 'line-color': 'rgba(0, 0, 0, 0.3)', 'line-width': 4 },
      layout: {
        'visibility': visible ? 'visible' : 'none',
        'line-cap': 'round',
        'line-join': 'round'
      }
    },
    before
  );

  map.addLayer(
    {
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
    },
    before
  );

  if (visible) updateRoute();
}

function setPhotoRouteVisible(show: boolean): void {
  visible = show;
  if (map === null) return;

  mapUtils.setLayersVisibility(map, ALL_ROUTE_LAYERS, show);

  if (!show) return;

  const album = data.filters.get().album;
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
function getData(): RouteData | null {
  return routeData;
}

/** Set route data and refresh the display source. */
function setData(route: RouteData | null): void {
  routeData = route;
  if (route === null) {
    updateRoute();
  } else {
    applyRouteData(route);
  }
}

/** Build the default straight-line route from current filtered photos. */
function buildDefault(): RouteData | null {
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
async function save(album: string, route: RouteData): Promise<void> {
  await fetch(`/api/albums/${encodeURIComponent(album)}/route`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(route)
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
  for (const photo of data.filteredPhotos.get()) {
    const loc = edits.getEffectiveLocation(photo);
    if (loc === null) continue;
    if (photo.date === '') continue;
    located.push({
      photo,
      loc,
      sortKey: toUtcSortKey(edits.getEffectiveDate(photo), photo.tz)
    });
  }
  located.sort((a, b) =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
  );
  return located;
}

/** Apply RouteData to the display source. */
function applyRouteData(route: RouteData): void {
  if (map === null) return;
  const src = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
  if (src === undefined) return;

  const features = buildRouteLineFeatures(route);
  src.setData({ type: 'FeatureCollection', features });
}

function refreshSavedRoute(route: RouteData): void {
  const synced = syncPhotoPoints(route);
  const reordered = reorderRoutePhotoPoints(route);
  applyRouteData(route);
  if (!synced && !reordered) return;
  if (edits.getCount() > 0) return;
  const album = data.filters.get().album;
  if (album !== 'all') void save(album, route);
}

function updateRoute(): void {
  if (map === null) return;

  const src = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
  if (src === undefined) return;

  if (routeData !== null) {
    refreshSavedRoute(routeData);
    return;
  }

  const album = data.filters.get().album;
  const route = album === 'all' ? null : buildDefault();
  if (route === null) {
    src.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  applyRouteData(route);
}

export default { init, getData, setData, buildDefault, save };
