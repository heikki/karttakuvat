import type { GeoJSONSource, Map as MapGL, MapMouseEvent } from 'maplibre-gl';

import { state, subscribe } from '@common/data';
import { RouteEditExitedEvent, ToggleRouteEditEvent } from '@common/events';
import type { Photo } from '@common/types';

import { setLayersVisibility } from './map-utils';
import {
  buildDefaultRoute,
  getSavedRouteData,
  saveRoute,
  setRouteData,
  setRouteEditStyle,
  setSavedRouteData,
  syncPhotoPoints,
  type RouteData
} from './photo-route';
import {
  ALL_EDIT_LAYERS,
  applySegmentMethod,
  buildRouteLineFeatures,
  createEditLayers,
  createSegmentPopup,
  EDIT_IDS,
  findNearestSegment,
  insertWaypointInRoute,
  removeWaypointFromRoute,
  rerouteSegment,
  updateAdjacentSegments
} from './route-edit-helpers';

// Module state
let map: MapGL | null = null;
let getMarkerLayerIdFn: () => string | null = () => null;
let isEditActive = false;
let routeData: RouteData | null = null;
let dragIndex: number | null = null;
let popupEl: HTMLElement | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let hoveredSegIdx: number | null = null;
let hoveredPointId: number | null = null;
let dragFromSegment = false;

export function isRouteEditMode(): boolean {
  return isEditActive;
}

export function initRouteEdit(
  m: MapGL,
  getMarkerLayerId: () => string | null
): void {
  map = m;
  getMarkerLayerIdFn = getMarkerLayerId;
  document.addEventListener(ToggleRouteEditEvent.type, () => {
    if (isEditActive) {
      exitEditMode();
    } else {
      enterEditMode();
    }
  });

  // Sync photo point positions when pending edits change
  subscribe(() => {
    if (isEditActive && routeData !== null) {
      syncPhotoPoints(routeData);
      updateEditSources();
    }
  });
}

export function addRouteEditLayers(): void {
  if (map === null) return;
  createEditLayers(map);
}

function enterEditMode(): void {
  if (isEditActive || map === null) return;
  isEditActive = true;

  // Build route data from saved route or default, sync photo positions
  routeData = getSavedRouteData() ?? buildDefaultRoute();
  if (routeData === null) return;
  syncPhotoPoints(routeData);

  map.getCanvas().classList.add('crosshair');
  setRouteEditStyle(true);
  setLayerVisibility(true);
  updateEditSources();

  map.on('click', onMapClick);
  map.on('contextmenu', onRightClick);
  map.on('mousedown', EDIT_IDS.points, onPointMouseDown);
  map.on('mousedown', EDIT_IDS.hit, onSegmentMouseDown);
  map.on('mouseenter', EDIT_IDS.hit, onSegmentEnter);
  map.on('mouseleave', EDIT_IDS.hit, onSegmentLeave);
  map.on('mousemove', EDIT_IDS.hit, onSegmentMove);
  map.on('mouseenter', EDIT_IDS.points, onPointEnter);
  map.on('mouseleave', EDIT_IDS.points, onPointLeave);
  document.addEventListener('keydown', onKeyDown);
}

function exitEditMode(): void {
  if (!isEditActive || map === null) return;
  isEditActive = false;

  map.getCanvas().classList.remove('crosshair');
  removePopup();
  // Restore blue display layers with current edit data
  if (routeData !== null) setRouteData(routeData);
  setRouteEditStyle(false);
  setLayerVisibility(false);

  map.off('click', onMapClick);
  map.off('contextmenu', onRightClick);
  map.off('mousedown', EDIT_IDS.points, onPointMouseDown);
  map.off('mousedown', EDIT_IDS.hit, onSegmentMouseDown);
  map.off('mouseenter', EDIT_IDS.hit, onSegmentEnter);
  map.off('mouseleave', EDIT_IDS.hit, onSegmentLeave);
  map.off('mousemove', EDIT_IDS.hit, onSegmentMove);
  map.off('mouseenter', EDIT_IDS.points, onPointEnter);
  map.off('mouseleave', EDIT_IDS.points, onPointLeave);
  clearHoverHighlight();
  hoveredPointId = null;
  document.removeEventListener('keydown', onKeyDown);

  // Clean up any drag handlers
  if (dragIndex !== null) {
    endDrag();
  }

  document.dispatchEvent(new RouteEditExitedEvent());
}

export function exitRouteEdit(): void {
  exitEditMode();
}

function setLayerVisibility(show: boolean): void {
  if (map === null) return;
  setLayersVisibility(map, ALL_EDIT_LAYERS, show);
}

function updateEditSources(): void {
  if (map === null || routeData === null) return;

  // Update points source
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- need GeoJSONSource for setData
  const pointsSrc = map.getSource(EDIT_IDS.pointsSrc) as
    | GeoJSONSource
    | undefined;
  if (pointsSrc !== undefined) {
    const photoMap = new Map<string, Photo>();
    for (const p of state.filteredPhotos) photoMap.set(p.uuid, p);
    pointsSrc.setData({
      type: 'FeatureCollection',
      features: routeData.points.map((p, i) => ({
        type: 'Feature' as const,
        id: i,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: {
          index: i,
          pointType: p.type,
          uuid: p.uuid ?? '',
          gps:
            (p.uuid === undefined ? null : photoMap.get(p.uuid)?.gps) ?? 'none'
        }
      }))
    });
  }

  // Update hit source — line segments for click targeting
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- need GeoJSONSource for setData
  const hitSrc = map.getSource(EDIT_IDS.hitSrc) as GeoJSONSource | undefined;
  if (hitSrc !== undefined) {
    hitSrc.setData({
      type: 'FeatureCollection',
      features: routeData.segments.map((seg, i) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: seg.geometry },
        properties: { segIndex: i }
      }))
    });
  }

  // Update edit-mode line source (concatenated route geometry)
  updateLineSrc();

  // Keep route data in sync (for save/load) but don't update display layers
  setSavedRouteData(routeData);

  // Ensure points layers stay on top (outline first, then fill)
  if (map.getLayer(EDIT_IDS.pointsOutline) !== undefined) {
    map.moveLayer(EDIT_IDS.pointsOutline);
  }
  if (map.getLayer(EDIT_IDS.points) !== undefined) {
    map.moveLayer(EDIT_IDS.points);
  }
}

function updateLineSrc(): void {
  if (map === null || routeData === null) return;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- need GeoJSONSource for setData
  const src = map.getSource(EDIT_IDS.lineSrc) as GeoJSONSource | undefined;
  if (src === undefined) return;
  const features = buildRouteLineFeatures(routeData);
  src.setData({ type: 'FeatureCollection', features });
}

function scheduleAutoSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const album = state.filters.album;
    if (album !== 'all' && routeData !== null) {
      void saveRoute(album, routeData);
    }
  }, 1000);
}

// --- Click handler ---

/** Find the first non-'none' segment index from hit query results. */
function firstClickableHit(
  features: Array<{ properties: Record<string, unknown> }>
): number | null {
  for (const f of features) {
    const idx = f.properties.segIndex as number;
    if (routeData?.segments[idx]?.method !== 'none') return idx;
  }
  return null;
}

function consumeDragFromSegment(): boolean {
  if (!dragFromSegment) return false;
  dragFromSegment = false;
  return true;
}

function isClickOnPhotoMarker(point: MapMouseEvent['point']): boolean {
  if (map === null) return false;
  const layerId = getMarkerLayerIdFn();
  if (layerId === null || map.getLayer(layerId) === undefined) return false;
  return map.queryRenderedFeatures(point, { layers: [layerId] }).length > 0;
}

function onMapClick(e: MapMouseEvent): void {
  if (map === null || routeData === null || consumeDragFromSegment()) return;

  // 1. Check if clicking on a route edit point
  const pointFeatures = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.points]
  });
  if (pointFeatures.length > 0) {
    const idx = pointFeatures[0]!.properties.index as number;
    if (routeData.points[idx]?.type === 'waypoint') removeWaypoint(idx);
    return;
  }

  // 2. Check if clicking on photo markers — pass through
  if (isClickOnPhotoMarker(e.point)) return;

  // 3. Add new waypoint — on segment if hit, otherwise nearest segment
  removePopup();
  const hitFeatures = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.hit]
  });
  const hitSegIdx = firstClickableHit(hitFeatures);
  if (hitSegIdx === null) {
    addWaypointAtClick(e.lngLat.lng, e.lngLat.lat);
  } else {
    insertWaypoint(hitSegIdx, e.lngLat.lng, e.lngLat.lat);
  }
}

function onRightClick(e: MapMouseEvent): void {
  if (map === null || routeData === null) return;
  e.preventDefault();

  const hitFeatures = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.hit]
  });
  if (hitFeatures.length > 0) {
    const segIdx = hitFeatures[0]!.properties.segIndex as number;
    showSegmentPopup(segIdx, e.lngLat.lng, e.lngLat.lat);
  }
}

function addWaypointAtClick(lon: number, lat: number): void {
  if (routeData === null || routeData.segments.length === 0 || map === null) {
    return;
  }
  const bestIdx = findNearestSegment(map, routeData, lon, lat);
  insertWaypoint(bestIdx, lon, lat);
}

function insertWaypoint(segIdx: number, lon: number, lat: number): void {
  if (routeData === null) return;

  const method = routeData.segments[segIdx]?.method ?? 'straight';
  if (method === 'none') return;
  insertWaypointInRoute(routeData, segIdx, lon, lat);

  if (method !== 'straight') {
    void Promise.all([
      rerouteSegment(routeData, segIdx),
      rerouteSegment(routeData, segIdx + 1)
    ]).then(() => {
      updateEditSources();
    });
  }

  updateEditSources();
  scheduleAutoSave();
}

function removeWaypoint(pointIdx: number): void {
  if (routeData === null) return;

  const segBefore = pointIdx - 1;
  const method = removeWaypointFromRoute(routeData, pointIdx);
  if (method === null) return;

  if (method !== 'straight') {
    void rerouteSegment(routeData, segBefore);
  }

  updateEditSources();
  scheduleAutoSave();
}

// --- Segment routing popup ---

function showSegmentPopup(segIdx: number, lon: number, lat: number): void {
  if (map === null) return;
  removePopup();
  popupEl = createSegmentPopup({
    map,
    lngLat: [lon, lat],
    currentMethod: routeData?.segments[segIdx]?.method ?? 'straight',
    onSelect: (method) => {
      if (routeData !== null) {
        void applySegmentMethod(routeData, segIdx, method).then((ok) => {
          updateEditSources();
          if (ok) {
            scheduleAutoSave();
          } else {
            showRouteError('Routing failed. Check your API key.');
          }
        });
      }
      removePopup();
    }
  });
  map.getContainer().appendChild(popupEl);
}

function removePopup(): void {
  if (popupEl !== null) {
    popupEl.remove();
    popupEl = null;
  }
}

function showRouteError(msg: string): void {
  if (map === null) return;
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText =
    'position:absolute;top:12px;left:50%;transform:translateX(-50%);' +
    'background:rgba(220,38,38,0.9);color:#fff;padding:8px 16px;border-radius:8px;' +
    'font:13px/1.4 -apple-system,sans-serif;z-index:1500;pointer-events:none;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.3)';
  map.getContainer().appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3000);
}

// --- Drag handler ---

function onPointMouseDown(e: MapMouseEvent): void {
  if (map === null || routeData === null || e.originalEvent.button !== 0) {
    return;
  }

  const features = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.points]
  });
  if (features.length === 0) return;

  const idx = features[0]!.properties.index as number;
  startDrag(idx, e);
}

function onSegmentMouseDown(e: MapMouseEvent): void {
  if (map === null || routeData === null || e.originalEvent.button !== 0) {
    return;
  }

  // Don't start segment drag if already on a point
  const pointFeatures = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.points]
  });
  if (pointFeatures.length > 0) return;

  const hitFeatures = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.hit]
  });
  const segIdx = firstClickableHit(hitFeatures);
  if (segIdx === null) return;
  insertWaypointInRoute(routeData, segIdx, e.lngLat.lng, e.lngLat.lat);
  updateEditSources();

  // The new waypoint is at segIdx + 1 in the points array
  dragFromSegment = true;
  startDrag(segIdx + 1, e);
}

function startDrag(idx: number, e: MapMouseEvent): void {
  if (map === null) return;
  dragIndex = idx;
  e.preventDefault();
  map.dragPan.disable();
  setCursorClass('cursor-grabbing');
  map.on('mousemove', onDragMove);
  map.on('mouseup', onDragEnd);
}

function onDragMove(e: MapMouseEvent): void {
  if (routeData === null || dragIndex === null) return;
  updateAdjacentSegments(routeData, dragIndex, e.lngLat.lng, e.lngLat.lat);
  updateEditSources();
}

function onDragEnd(): void {
  if (routeData === null || dragIndex === null) return;

  const idx = dragIndex;
  endDrag();

  // Re-route affected segments if they aren't straight
  const segBefore = idx - 1;
  const segAfter = idx;

  const promises: Array<Promise<void>> = [];
  if (segBefore >= 0 && routeData.segments[segBefore]?.method !== 'straight') {
    promises.push(rerouteSegment(routeData, segBefore));
  }
  if (
    segAfter < routeData.segments.length &&
    routeData.segments[segAfter]?.method !== 'straight'
  ) {
    promises.push(rerouteSegment(routeData, segAfter));
  }

  if (promises.length > 0) {
    void Promise.all(promises).then(() => {
      updateEditSources();
      scheduleAutoSave();
    });
  } else {
    scheduleAutoSave();
  }
}

function endDrag(): void {
  dragIndex = null;
  if (map === null) return;
  map.dragPan.enable();
  setCursorClass(null);
  map.off('mousemove', onDragMove);
  map.off('mouseup', onDragEnd);
}

// --- Cursor helpers ---

const CURSOR_CLASSES = ['cursor-pointer', 'cursor-grab', 'cursor-grabbing'];

function setCursorClass(cls: string | null): void {
  if (map === null) return;
  const canvas = map.getCanvas();
  for (const c of CURSOR_CLASSES) canvas.classList.remove(c);
  if (cls !== null) canvas.classList.add(cls);
}

// --- Hover handlers ---

function onSegmentEnter(): void {
  if (dragIndex === null) setCursorClass('cursor-pointer');
}

function onSegmentLeave(): void {
  if (dragIndex === null) setCursorClass(null);
  clearHoverHighlight();
}

function setHoverSource(geojson: object): void {
  if (map === null) return;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- need GeoJSONSource for setData
  const src = map.getSource(EDIT_IDS.hoverSrc) as GeoJSONSource | undefined;
  src?.setData(geojson as GeoJSON.GeoJSON);
}

function onSegmentMove(e: MapMouseEvent): void {
  if (
    map === null ||
    routeData === null ||
    dragIndex !== null ||
    hoveredPointId !== null
  ) {
    return;
  }
  const features = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.hit]
  });
  const segIdx = firstClickableHit(features);
  if (segIdx === null) {
    clearHoverHighlight();
    return;
  }
  if (segIdx === hoveredSegIdx) return;
  hoveredSegIdx = segIdx;
  const seg = routeData.segments[segIdx];
  if (seg === undefined) return;
  setHoverSource({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: seg.geometry },
    properties: {}
  });
}

function clearHoverHighlight(): void {
  if (hoveredSegIdx === null) return;
  hoveredSegIdx = null;
  setHoverSource({ type: 'FeatureCollection', features: [] });
}

function onPointEnter(e: MapMouseEvent): void {
  if (dragIndex === null) setCursorClass('cursor-pointer');
  clearHoverHighlight();
  if (map === null) return;
  const features = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.points]
  });
  const id = features[0]?.id as number | undefined;
  if (id === undefined) return;
  hoveredPointId = id;
}

function onPointLeave(): void {
  hoveredPointId = null;
  if (dragIndex === null) {
    setCursorClass(hoveredSegIdx === null ? null : 'cursor-pointer');
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') exitEditMode();
}
