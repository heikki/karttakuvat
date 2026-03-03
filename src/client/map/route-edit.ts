import type { GeoJSONSource, Map as MapGL, MapMouseEvent } from 'maplibre-gl';

import { state } from '@common/data';
import { RouteEditExitedEvent, ToggleRouteEditEvent } from '@common/events';

import {
  buildDefaultRoute,
  getSavedRouteData,
  saveRoute,
  setRouteData,
  setRouteEditStyle,
  setSavedRouteData,
  type RouteData,
  type RoutePoint,
  type RouteSegment
} from './photo-route';
import { createSegmentPopup, distToPolyline } from './route-edit-helpers';

// Sources and layers for edit mode
const LINE_SOURCE = 'route-edit-line';
const LINE_OUTLINE_LAYER = 'route-edit-line-outline';
const LINE_LAYER = 'route-edit-line-layer';
const POINTS_SOURCE = 'route-edit-points';
const POINTS_LAYER = 'route-edit-points-layer';
const HIT_SOURCE = 'route-edit-hit';
const HIT_LAYER = 'route-edit-hit-layer';

// Module state
let map: MapGL | null = null;
let getMarkerLayerIdFn: () => string | null = () => null;
let isEditActive = false;
let routeData: RouteData | null = null;
let dragIndex: number | null = null;
let popupEl: HTMLElement | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

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
}

export function addRouteEditLayers(): void {
  if (map === null) return;

  // Clean up existing
  for (const id of [HIT_LAYER, POINTS_LAYER, LINE_LAYER, LINE_OUTLINE_LAYER]) {
    if (map.getLayer(id) !== undefined) map.removeLayer(id);
  }
  for (const id of [HIT_SOURCE, POINTS_SOURCE, LINE_SOURCE]) {
    if (map.getSource(id) !== undefined) map.removeSource(id);
  }

  const empty = { type: 'FeatureCollection' as const, features: [] };

  map.addSource(LINE_SOURCE, { type: 'geojson', data: empty });
  map.addSource(POINTS_SOURCE, { type: 'geojson', data: empty });
  map.addSource(HIT_SOURCE, { type: 'geojson', data: empty });

  // Transparent red route line for edit mode
  map.addLayer({
    id: LINE_OUTLINE_LAYER,
    type: 'line',
    source: LINE_SOURCE,
    paint: { 'line-color': 'rgba(0, 0, 0, 0.15)', 'line-width': 7 },
    layout: { 'visibility': 'none', 'line-cap': 'round', 'line-join': 'round' }
  });

  map.addLayer({
    id: LINE_LAYER,
    type: 'line',
    source: LINE_SOURCE,
    paint: { 'line-color': 'rgba(220, 38, 38, 0.5)', 'line-width': 4 },
    layout: { 'visibility': 'none', 'line-cap': 'round', 'line-join': 'round' }
  });

  // Invisible wide line for click targeting on segments
  map.addLayer({
    id: HIT_LAYER,
    type: 'line',
    source: HIT_SOURCE,
    paint: { 'line-color': 'rgba(0,0,0,0)', 'line-width': 16 },
    layout: { visibility: 'none' }
  });

  // Point circles for route points
  map.addLayer({
    id: POINTS_LAYER,
    type: 'circle',
    source: POINTS_SOURCE,
    paint: {
      'circle-radius': ['match', ['get', 'pointType'], 'photo', 7, 6],
      'circle-color': [
        'match',
        ['get', 'pointType'],
        'photo',
        '#60a5fa',
        '#ffffff'
      ],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': [
        'match',
        ['get', 'pointType'],
        'photo',
        '#1d4ed8',
        '#1d4ed8'
      ]
    },
    layout: { visibility: 'none' }
  });
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
  map.on('mousedown', POINTS_LAYER, onPointMouseDown);
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
  map.off('mousedown', POINTS_LAYER, onPointMouseDown);
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
  for (const id of [LINE_OUTLINE_LAYER, LINE_LAYER, POINTS_LAYER, HIT_LAYER]) {
    if (map.getLayer(id) !== undefined) {
      map.setLayoutProperty(id, 'visibility', v);
    }
  }
}

function updateEditSources(): void {
  if (map === null || routeData === null) return;

  // Update points source
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- need GeoJSONSource for setData
  const pointsSrc = map.getSource(POINTS_SOURCE) as GeoJSONSource | undefined;
  if (pointsSrc !== undefined) {
    pointsSrc.setData({
      type: 'FeatureCollection',
      features: routeData.points.map((p, i) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: { index: i, pointType: p.type, uuid: p.uuid ?? '' }
      }))
    });
  }

  // Update hit source — line segments for click targeting
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- need GeoJSONSource for setData
  const hitSrc = map.getSource(HIT_SOURCE) as GeoJSONSource | undefined;
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

  // Ensure points layer stays on top
  if (map.getLayer(POINTS_LAYER) !== undefined) {
    map.moveLayer(POINTS_LAYER);
  }
}

function updateLineSrc(): void {
  if (map === null || routeData === null) return;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- need GeoJSONSource for setData
  const lineSrc = map.getSource(LINE_SOURCE) as GeoJSONSource | undefined;
  if (lineSrc === undefined) return;

  const allCoords: Array<[number, number]> = [];
  for (const seg of routeData.segments) {
    for (let j = 0; j < seg.geometry.length; j++) {
      if (allCoords.length > 0 && j === 0) continue;
      allCoords.push(seg.geometry[j]!);
    }
  }
  lineSrc.setData(
    allCoords.length >= 2
      ? {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: allCoords },
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
    layers: [POINTS_LAYER]
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
    layers: [HIT_LAYER]
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
    layers: [HIT_LAYER]
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

  // Find nearest segment using screen-space distance (pixels)
  // This is critical for back-and-forth routes where segments overlap geographically
  const m = map;
  const clickPx = m.project([lon, lat]);
  const toScreen = (c: [number, number]): [number, number] => {
    const p = m.project(c);
    return [p.x, p.y];
  };
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < routeData.segments.length; i++) {
    const seg = routeData.segments[i]!;
    const screenCoords = seg.geometry.map(toScreen);
    const dist = distToPolyline(clickPx.x, clickPx.y, screenCoords);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  insertWaypoint(bestIdx, lon, lat);
}

function insertWaypoint(segIdx: number, lon: number, lat: number): void {
  if (routeData === null) return;

  const newPoint: RoutePoint = { type: 'waypoint', lon, lat };
  routeData.points.splice(segIdx + 1, 0, newPoint);

  const oldSeg = routeData.segments[segIdx]!;
  const prevPt = routeData.points[segIdx]!;
  const nextPt = routeData.points[segIdx + 2]!;
  const method = oldSeg.method;
  const seg1: RouteSegment = {
    method,
    geometry: [
      [prevPt.lon, prevPt.lat],
      [lon, lat]
    ]
  };
  const seg2: RouteSegment = {
    method,
    geometry: [
      [lon, lat],
      [nextPt.lon, nextPt.lat]
    ]
  };
  routeData.segments.splice(segIdx, 1, seg1, seg2);

  // If original was routed, re-fetch both new sub-segments
  if (method !== 'straight') {
    void Promise.all([rerouteSegment(segIdx), rerouteSegment(segIdx + 1)]).then(
      () => {
        updateEditSources();
      }
    );
  }

  updateEditSources();
  scheduleAutoSave();
}

function removeWaypoint(pointIdx: number): void {
  if (routeData === null) return;
  if (routeData.points[pointIdx]?.type !== 'waypoint') return;

  // Remove point and merge two adjacent segments into one
  const segBefore = pointIdx - 1;
  const prevPt = routeData.points[pointIdx - 1]!;
  const nextPt = routeData.points[pointIdx + 1]!;

  // Use the method from the segment before the removed point
  const method = routeData.segments[segBefore]?.method ?? 'straight';

  routeData.points.splice(pointIdx, 1);
  const merged: RouteSegment = {
    method,
    geometry: [
      [prevPt.lon, prevPt.lat],
      [nextPt.lon, nextPt.lat]
    ]
  };
  routeData.segments.splice(segBefore, 2, merged);

  if (method !== 'straight') {
    void rerouteSegment(segBefore);
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
      void changeSegmentMethod(segIdx, method);
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

async function changeSegmentMethod(
  segIdx: number,
  method: RouteSegment['method']
): Promise<void> {
  if (routeData === null) return;
  const seg = routeData.segments[segIdx];
  if (seg === undefined) return;

  seg.method = method;

  if (method === 'straight') {
    // Just use straight line between endpoints
    const startPt = routeData.points[segIdx]!;
    const endPt = routeData.points[segIdx + 1]!;
    seg.geometry = [
      [startPt.lon, startPt.lat],
      [endPt.lon, endPt.lat]
    ];
    updateEditSources();
    scheduleAutoSave();
  } else {
    await rerouteSegment(segIdx);
    updateEditSources();
    scheduleAutoSave();
  }
}

async function rerouteSegment(segIdx: number): Promise<void> {
  if (routeData === null) return;
  const seg = routeData.segments[segIdx];
  if (seg === undefined || seg.method === 'straight') return;

  const startPt = routeData.points[segIdx]!;
  const endPt = routeData.points[segIdx + 1]!;

  try {
    const resp = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: [
          [startPt.lon, startPt.lat],
          [endPt.lon, endPt.lat]
        ],
        profile: seg.method
      })
    });

    if (!resp.ok) return;

    const data = (await resp.json()) as {
      geometry: { coordinates: Array<[number, number]> };
    };
    seg.geometry = data.geometry.coordinates;
  } catch {
    // Fall back to straight line on error
    seg.geometry = [
      [startPt.lon, startPt.lat],
      [endPt.lon, endPt.lat]
    ];
  }
}

// --- Drag handler ---

function onPointMouseDown(e: MapMouseEvent): void {
  if (map === null || routeData === null) return;

  const features = map.queryRenderedFeatures(e.point, {
    layers: [POINTS_LAYER]
  });
  if (features.length === 0) return;

  const idx = features[0]!.properties.index as number;
  dragIndex = idx;

  e.preventDefault();
  map.dragPan.disable();
  map.getCanvas().style.cursor = 'grabbing';

  map.on('mousemove', onDragMove);
  map.on('mouseup', onDragEnd);
}

function onDragMove(e: MapMouseEvent): void {
  if (routeData === null || dragIndex === null) return;

  const pt = routeData.points[dragIndex];
  if (pt === undefined) return;

  pt.lon = e.lngLat.lng;
  pt.lat = e.lngLat.lat;

  // Update adjacent segment geometries (straight lines during drag)
  const segBefore = dragIndex - 1;
  const segAfter = dragIndex;

  if (segBefore >= 0 && routeData.segments[segBefore] !== undefined) {
    const prevPt = routeData.points[dragIndex - 1]!;
    const seg = routeData.segments[segBefore];
    seg.geometry = [
      [prevPt.lon, prevPt.lat],
      [pt.lon, pt.lat]
    ];
  }

  if (
    segAfter < routeData.segments.length &&
    routeData.segments[segAfter] !== undefined
  ) {
    const nextPt = routeData.points[dragIndex + 1]!;
    const seg = routeData.segments[segAfter];
    seg.geometry = [
      [pt.lon, pt.lat],
      [nextPt.lon, nextPt.lat]
    ];
  }

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
    promises.push(rerouteSegment(segBefore));
  }
  if (
    segAfter < routeData.segments.length &&
    routeData.segments[segAfter]?.method !== 'straight'
  ) {
    promises.push(rerouteSegment(segAfter));
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
  map.getCanvas().style.cursor = 'crosshair';
  map.off('mousemove', onDragMove);
  map.off('mouseup', onDragEnd);
}

// --- Key handler ---

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    exitEditMode();
  }
}
