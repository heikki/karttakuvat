import type {
  GeoJSONSource,
  Map as MapGL,
  MapLayerMouseEvent,
  MapMouseEvent
} from 'maplibre-gl';

import * as data from '@common/data';
import * as edits from '@common/edits';
import {
  RouteEditModeChangedEvent,
  ToggleRouteEditEvent
} from '@common/events';
import type { Photo } from '@common/types';

import route, { type RouteData } from '.';
import mapUtils from '../map-utils';
import {
  ALL_EDIT_LAYERS,
  applySegmentMethod,
  buildRouteLineFeatures,
  createSegmentPopup,
  EDIT_IDS,
  findNearestSegment,
  insertWaypointInRoute,
  removeWaypointFromRoute,
  rerouteSegment,
  updateAdjacentSegments
} from './helpers';
import { syncPhotoPoints } from './reconcile';

// ---------- State machine ----------

/**
 * Pointer interaction state during edit mode. `null` means edit mode is off.
 *  - idle: cursor is not over any clickable thing
 *  - hoveringSegment: cursor is over a route segment (highlight is shown)
 *  - hoveringPoint: cursor is over a route point (segment highlight is cleared)
 *  - dragging: a point is being dragged
 */
type InteractionState =
  | { kind: 'idle' }
  | { kind: 'hoveringSegment'; segIdx: number }
  | { kind: 'hoveringPoint'; pointId: number }
  | { kind: 'dragging'; pointIdx: number };

let map: MapGL | null = null;
let interaction: InteractionState | null = null;
let routeData: RouteData | null = null;
let popupEl: HTMLElement | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// Set when a segment-hit mousedown both inserted a waypoint and started a
// drag, so the trailing click event can be ignored. Cleared on the click
// (via consume) and on enter/exit (so a stale flag from an Escape-during-drag
// doesn't leak into the next session).
let suppressNextMapClick = false;

function isActive(): boolean {
  return interaction !== null;
}

/** Apply a state transition with the appropriate side effects. */
function transition(next: InteractionState | null): void {
  const prev = interaction;
  interaction = next;

  // Segment hover highlight: present iff state is hoveringSegment.
  const prevSeg = prev?.kind === 'hoveringSegment' ? prev.segIdx : null;
  const nextSeg = next?.kind === 'hoveringSegment' ? next.segIdx : null;
  if (prevSeg !== nextSeg) {
    if (nextSeg === null) {
      clearHoverHighlight();
    } else {
      showHoverHighlight(nextSeg);
    }
  }

  setCursorClass(cursorFor(next));
}

function cursorFor(s: InteractionState | null): string | null {
  if (s === null) return null;
  switch (s.kind) {
    case 'dragging':
      return 'cursor-grabbing';
    case 'hoveringSegment':
    case 'hoveringPoint':
      return 'cursor-pointer';
    case 'idle':
      return null;
  }
}

// ---------- Public API ----------

export function initRouteEdit(m: MapGL): void {
  map = m;
  document.addEventListener(ToggleRouteEditEvent.type, () => {
    if (isActive()) {
      exitRouteEdit();
    } else {
      enterEditMode();
    }
  });

  // Sync photo point positions when pending edits change
  edits.subscribe(() => {
    if (isActive() && routeData !== null) {
      syncPhotoPoints(routeData);
      updateEditSources();
    }
  });
}

// ---------- Lifecycle ----------

function enterEditMode(): void {
  if (isActive() || map === null) return;

  // Build route data from saved route or default, sync photo positions.
  // exitRouteEdit pushes routeData back into the display module; nothing
  // reads route.getData() between enter and exit so we don't push it now.
  routeData = route.getData() ?? route.buildDefault();
  if (routeData === null) return;
  syncPhotoPoints(routeData);

  suppressNextMapClick = false;
  map.getCanvas().classList.add('crosshair');
  document.dispatchEvent(new RouteEditModeChangedEvent(true));
  setLayerVisibility(true);
  raiseEditPoints();
  updateEditSources();

  map.on('click', onMapClick);
  map.on('contextmenu', onRightClick);
  map.on('mousedown', EDIT_IDS.points, onPointMouseDown);
  map.on('mousedown', EDIT_IDS.hit, onSegmentMouseDown);
  map.on('mouseleave', EDIT_IDS.hit, onSegmentLeave);
  map.on('mousemove', EDIT_IDS.hit, onSegmentMove);
  map.on('mouseenter', EDIT_IDS.points, onPointEnter);
  map.on('mouseleave', EDIT_IDS.points, onPointLeave);
  document.addEventListener('keydown', onKeyDown);

  transition({ kind: 'idle' });
}

export function exitRouteEdit(): void {
  if (!isActive() || map === null) return;

  // If a drag was in progress, tear down its mousemove/mouseup handlers.
  if (interaction?.kind === 'dragging') teardownDragListeners();

  transition(null);
  suppressNextMapClick = false;
  map.getCanvas().classList.remove('crosshair');
  removePopup();
  // Restore blue display layers with current edit data
  if (routeData !== null) route.setData(routeData);
  document.dispatchEvent(new RouteEditModeChangedEvent(false));
  setLayerVisibility(false);

  map.off('click', onMapClick);
  map.off('contextmenu', onRightClick);
  map.off('mousedown', EDIT_IDS.points, onPointMouseDown);
  map.off('mousedown', EDIT_IDS.hit, onSegmentMouseDown);
  map.off('mouseleave', EDIT_IDS.hit, onSegmentLeave);
  map.off('mousemove', EDIT_IDS.hit, onSegmentMove);
  map.off('mouseenter', EDIT_IDS.points, onPointEnter);
  map.off('mouseleave', EDIT_IDS.points, onPointLeave);
  document.removeEventListener('keydown', onKeyDown);
}

function setLayerVisibility(show: boolean): void {
  if (map === null) return;
  mapUtils.setLayersVisibility(map, ALL_EDIT_LAYERS, show);
}

// ---------- Source updates ----------

function updateEditSources(): void {
  if (map === null || routeData === null) return;

  const pointsSrc = map.getSource<GeoJSONSource>(EDIT_IDS.pointsSrc);
  if (pointsSrc !== undefined) {
    const photoMap = new Map<string, Photo>();
    for (const p of data.state.filteredPhotos) photoMap.set(p.uuid, p);
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

  const hitSrc = map.getSource<GeoJSONSource>(EDIT_IDS.hitSrc);
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

  updateLineSrc();
}

/** Bring edit-mode points on top of marker/photo layers added after our edit layers. */
function raiseEditPoints(): void {
  if (map === null) return;
  if (map.getLayer(EDIT_IDS.pointsOutline) !== undefined) {
    map.moveLayer(EDIT_IDS.pointsOutline);
  }
  if (map.getLayer(EDIT_IDS.points) !== undefined) {
    map.moveLayer(EDIT_IDS.points);
  }
}

function updateLineSrc(): void {
  if (map === null || routeData === null) return;
  const src = map.getSource<GeoJSONSource>(EDIT_IDS.lineSrc);
  if (src === undefined) return;
  const features = buildRouteLineFeatures(routeData);
  src.setData({ type: 'FeatureCollection', features });
}

function scheduleAutoSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const album = data.state.filters.album;
    if (album !== 'all' && routeData !== null) {
      void route.save(album, routeData);
    }
  }, 1000);
}

// ---------- Click / right-click ----------

/** Find the first non-'none' segment index from hit query results. */
function firstClickableHit(
  features: Array<{ properties: Record<string, unknown> }> | undefined
): number | null {
  if (features === undefined) return null;
  for (const f of features) {
    const idx = f.properties.segIndex as number;
    if (routeData?.segments[idx]?.method !== 'none') return idx;
  }
  return null;
}

function onMapClick(e: MapMouseEvent): void {
  if (map === null || routeData === null) return;
  if (suppressNextMapClick) {
    suppressNextMapClick = false;
    return;
  }

  // 1. Check if clicking on a route edit point
  const pointFeatures = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.points]
  });
  if (pointFeatures.length > 0) {
    const idx = pointFeatures[0]!.properties.index as number;
    if (routeData.points[idx]?.type === 'waypoint') removeWaypoint(idx);
    return;
  }

  // 2. Click-through to photo markers
  if (e.defaultPrevented) return;

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

// ---------- Segment routing popup ----------

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

// ---------- Drag ----------

function onPointMouseDown(e: MapLayerMouseEvent): void {
  if (map === null || routeData === null || e.originalEvent.button !== 0) {
    return;
  }
  const feature = e.features?.[0];
  if (feature === undefined) return;
  const idx = feature.properties.index as number;
  startDrag(idx, e);
}

function onSegmentMouseDown(e: MapLayerMouseEvent): void {
  if (map === null || routeData === null || e.originalEvent.button !== 0) {
    return;
  }
  // Don't start segment drag if also on a point
  const pointFeatures = map.queryRenderedFeatures(e.point, {
    layers: [EDIT_IDS.points]
  });
  if (pointFeatures.length > 0) return;

  const segIdx = firstClickableHit(e.features);
  if (segIdx === null) return;
  insertWaypointInRoute(routeData, segIdx, e.lngLat.lng, e.lngLat.lat);
  updateEditSources();

  // The new waypoint is at segIdx + 1; suppress the trailing click.
  suppressNextMapClick = true;
  startDrag(segIdx + 1, e);
}

function startDrag(idx: number, e: MapMouseEvent): void {
  if (map === null) return;
  e.preventDefault();
  map.dragPan.disable();
  map.on('mousemove', onDragMove);
  map.on('mouseup', onDragEnd);
  // Fallback: maplibre's mouseup is canvas-bound and won't fire if the
  // user releases outside the map container.
  document.addEventListener('mouseup', onDragEnd);
  transition({ kind: 'dragging', pointIdx: idx });
}

function onDragMove(e: MapMouseEvent): void {
  if (routeData === null || interaction?.kind !== 'dragging') return;
  updateAdjacentSegments(
    routeData,
    interaction.pointIdx,
    e.lngLat.lng,
    e.lngLat.lat
  );
  updateEditSources();
}

function onDragEnd(): void {
  if (routeData === null || interaction?.kind !== 'dragging') return;
  const idx = interaction.pointIdx;
  teardownDragListeners();
  transition({ kind: 'idle' });
  rerouteAfterDrag(idx);
}

function rerouteAfterDrag(pointIdx: number): void {
  if (routeData === null) return;
  const segBefore = pointIdx - 1;
  const segAfter = pointIdx;
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

function teardownDragListeners(): void {
  if (map === null) return;
  map.dragPan.enable();
  map.off('mousemove', onDragMove);
  map.off('mouseup', onDragEnd);
  document.removeEventListener('mouseup', onDragEnd);
}

// ---------- Cursor & hover ----------

const CURSOR_CLASSES = ['cursor-pointer', 'cursor-grabbing'];

function setCursorClass(cls: string | null): void {
  if (map === null) return;
  const canvas = map.getCanvas();
  for (const c of CURSOR_CLASSES) canvas.classList.remove(c);
  if (cls !== null) canvas.classList.add(cls);
}

function setHoverSource(geojson: object): void {
  if (map === null) return;
  const src = map.getSource<GeoJSONSource>(EDIT_IDS.hoverSrc);
  src?.setData(geojson as GeoJSON.GeoJSON);
}

function showHoverHighlight(segIdx: number): void {
  if (routeData === null) return;
  const seg = routeData.segments[segIdx];
  if (seg === undefined) return;
  setHoverSource({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: seg.geometry },
    properties: {}
  });
}

function clearHoverHighlight(): void {
  setHoverSource({ type: 'FeatureCollection', features: [] });
}

// ---------- Hover handlers ----------

function onSegmentLeave(): void {
  if (interaction?.kind === 'hoveringSegment') {
    transition({ kind: 'idle' });
  }
}

function onSegmentMove(e: MapLayerMouseEvent): void {
  if (
    map === null ||
    routeData === null ||
    interaction === null ||
    interaction.kind === 'dragging' ||
    interaction.kind === 'hoveringPoint'
  ) {
    return;
  }
  const segIdx = firstClickableHit(e.features);
  if (segIdx === null) {
    if (interaction.kind === 'hoveringSegment') {
      transition({ kind: 'idle' });
    }
    return;
  }
  if (interaction.kind === 'hoveringSegment' && interaction.segIdx === segIdx) {
    return;
  }
  transition({ kind: 'hoveringSegment', segIdx });
}

function onPointEnter(e: MapLayerMouseEvent): void {
  if (map === null || interaction === null || interaction.kind === 'dragging') {
    return;
  }
  const id = e.features?.[0]?.id as number | undefined;
  if (id === undefined) return;
  transition({ kind: 'hoveringPoint', pointId: id });
}

function onPointLeave(): void {
  if (interaction?.kind === 'hoveringPoint') {
    transition({ kind: 'idle' });
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') exitRouteEdit();
}
