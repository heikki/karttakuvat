import type { GeoJSONSource, Map as MapGL, MapMouseEvent } from 'maplibre-gl';

import { state, subscribe } from '@common/data';
import { RouteEditExitedEvent, ToggleRouteEditEvent } from '@common/events';
import type { Photo } from '@common/types';

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
  concatRouteCoords,
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

  // Build route data from saved route or default
  routeData = getSavedRouteData() ?? buildDefaultRoute();
  if (routeData === null) return;

  map.getCanvas().classList.add('crosshair');
  setRouteEditStyle(true);
  setLayerVisibility(true);
  updateEditSources();

  map.on('click', onMapClick);
  map.on('contextmenu', onRightClick);
  map.on('mousedown', EDIT_IDS.points, onPointMouseDown);
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
  const v = show ? 'visible' : 'none';
  for (const id of ALL_EDIT_LAYERS) {
    if (map.getLayer(id) !== undefined) {
      map.setLayoutProperty(id, 'visibility', v);
    }
  }
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
  const c = concatRouteCoords(routeData);
  src.setData(
    c.length >= 2
      ? {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: c },
          properties: {}
        }
      : { type: 'FeatureCollection', features: [] }
  );
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

function onMapClick(e: MapMouseEvent): void {
  if (map === null || routeData === null) return;

  // 1. Check if clicking on a route edit point
  const pointFeatures = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.points]
  });
  if (pointFeatures.length > 0) {
    const idx = pointFeatures[0]!.properties.index as number;
    const pt = routeData.points[idx];
    if (pt?.type === 'waypoint') {
      removeWaypoint(idx);
      return;
    }
    // Photo anchor — ignore click
    return;
  }

  // 2. Check if clicking on photo markers — pass through
  const markerLayerId = getMarkerLayerIdFn();
  if (markerLayerId !== null && map.getLayer(markerLayerId) !== undefined) {
    const markerFeatures = map.queryRenderedFeatures(e.point, {
      layers: [markerLayerId]
    });
    if (markerFeatures.length > 0) return;
  }

  // 3. Add new waypoint — on segment if hit, otherwise nearest segment
  removePopup();
  const hitFeatures = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.hit]
  });
  if (hitFeatures.length > 0) {
    const segIdx = hitFeatures[0]!.properties.segIndex as number;
    insertWaypoint(segIdx, e.lngLat.lng, e.lngLat.lat);
  } else {
    addWaypointAtClick(e.lngLat.lng, e.lngLat.lat);
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
        void applySegmentMethod(routeData, segIdx, method).then(() => {
          updateEditSources();
          scheduleAutoSave();
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

// --- Drag handler ---

function onPointMouseDown(e: MapMouseEvent): void {
  if (map === null || routeData === null) return;

  const features = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.points]
  });
  if (features.length === 0) return;

  const idx = features[0]!.properties.index as number;
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
  if (features.length === 0) {
    clearHoverHighlight();
    return;
  }
  const segIdx = features[0]!.properties.segIndex as number;
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
