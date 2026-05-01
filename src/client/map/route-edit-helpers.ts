import type { Feature, LineString } from 'geojson';
import type { Map as MapGL } from 'maplibre-gl';

import { HAS_ROUTING } from '@common/features';

import type { RouteData, RoutePoint, RouteSegment } from './photo-route';

/** Layer/source IDs for route edit mode. */
export const EDIT_IDS = {
  lineSrc: 'route-edit-line',
  lineOutline: 'route-edit-line-outline',
  line: 'route-edit-line-layer',
  pointsSrc: 'route-edit-points',
  pointsOutline: 'route-edit-points-outline',
  points: 'route-edit-points-layer',
  hitSrc: 'route-edit-hit',
  hit: 'route-edit-hit-layer',
  hoverSrc: 'route-edit-hover',
  hover: 'route-edit-hover-layer'
} as const;

export const ALL_EDIT_LAYERS = [
  EDIT_IDS.hit,
  EDIT_IDS.hover,
  EDIT_IDS.points,
  EDIT_IDS.pointsOutline,
  EDIT_IDS.line,
  EDIT_IDS.lineOutline
];
const ALL_SOURCES = [
  EDIT_IDS.hitSrc,
  EDIT_IDS.hoverSrc,
  EDIT_IDS.pointsSrc,
  EDIT_IDS.lineSrc
];

/** Add all route-edit sources and layers to the map. */
export function createEditLayers(m: MapGL): void {
  const empty = { type: 'FeatureCollection' as const, features: [] };
  for (const id of ALL_SOURCES) {
    m.addSource(id, { type: 'geojson', data: empty });
  }

  const lineLayout = {
    'visibility': 'none' as const,
    'line-cap': 'round' as const,
    'line-join': 'round' as const
  };

  m.addLayer({
    id: EDIT_IDS.lineOutline,
    type: 'line',
    source: EDIT_IDS.lineSrc,
    paint: { 'line-color': 'rgba(0, 0, 0, 0.3)', 'line-width': 4 },
    layout: lineLayout
  });
  m.addLayer({
    id: EDIT_IDS.line,
    type: 'line',
    source: EDIT_IDS.lineSrc,
    paint: { 'line-color': '#60a5fa', 'line-width': 2 },
    layout: lineLayout
  });
  m.addLayer({
    id: EDIT_IDS.hit,
    type: 'line',
    source: EDIT_IDS.hitSrc,
    paint: { 'line-color': 'rgba(0,0,0,0)', 'line-width': 16 },
    layout: {
      'visibility': 'none' as const,
      'line-cap': 'round' as const,
      'line-join': 'round' as const
    }
  });
  m.addLayer({
    id: EDIT_IDS.hover,
    type: 'line',
    source: EDIT_IDS.hoverSrc,
    paint: { 'line-color': 'rgba(255, 255, 255, 0.6)', 'line-width': 6 },
    layout: lineLayout
  });
  // Photo points: same size as classic markers (zoom-interpolated)
  // Waypoints: half size
  const pointRadius = [
    'interpolate',
    ['linear'],
    ['zoom'],
    2,
    ['match', ['get', 'pointType'], 'photo', 3, 1.5],
    8,
    ['match', ['get', 'pointType'], 'photo', 6, 3],
    14,
    ['match', ['get', 'pointType'], 'photo', 10, 5]
  ] as unknown as number;

  const outlineRadius = [
    'interpolate',
    ['linear'],
    ['zoom'],
    2,
    ['match', ['get', 'pointType'], 'photo', 4, 2],
    8,
    ['match', ['get', 'pointType'], 'photo', 7.5, 4],
    14,
    ['match', ['get', 'pointType'], 'photo', 12, 6.5]
  ] as unknown as number;

  const gpsColor = [
    'match',
    ['get', 'gps'],
    'exif',
    '#3b82f6',
    'user',
    '#22c55e',
    'inferred',
    '#f59e0b',
    '#9ca3af'
  ] as unknown as string;

  // White outline circle behind colored fill (same approach as classic markers)
  m.addLayer({
    id: EDIT_IDS.pointsOutline,
    type: 'circle',
    source: EDIT_IDS.pointsSrc,
    paint: {
      'circle-color': '#fff',
      'circle-radius': outlineRadius,
      'circle-pitch-alignment': 'map'
    },
    layout: { visibility: 'none' }
  });

  // Colored fill on top — GPS-based color, no stroke
  m.addLayer({
    id: EDIT_IDS.points,
    type: 'circle',
    source: EDIT_IDS.pointsSrc,
    paint: {
      'circle-color': gpsColor,
      'circle-radius': pointRadius,
      'circle-pitch-alignment': 'map'
    },
    layout: { visibility: 'none' }
  });
}

/** Update adjacent segment endpoints when a point is dragged. */
export function updateAdjacentSegments(
  data: RouteData,
  pointIdx: number,
  lon: number,
  lat: number
): void {
  const pt = data.points[pointIdx];
  if (pt === undefined) return;
  pt.lon = lon;
  pt.lat = lat;
  const before = pointIdx - 1;
  const after = pointIdx;
  const segBefore = before >= 0 ? data.segments[before] : undefined;
  if (segBefore !== undefined) {
    const prev = data.points[pointIdx - 1]!;
    segBefore.geometry = [
      [prev.lon, prev.lat],
      [lon, lat]
    ];
  }
  const segAfter =
    after < data.segments.length ? data.segments[after] : undefined;
  if (segAfter !== undefined) {
    const next = data.points[pointIdx + 1]!;
    segAfter.geometry = [
      [lon, lat],
      [next.lon, next.lat]
    ];
  }
}

/** Build line features from route segments, breaking at 'none' segments. */
export function buildRouteLineFeatures(
  data: RouteData
): Array<Feature<LineString>> {
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
    for (let j = 0; j < seg.geometry.length; j++) {
      if (current.length > 0 && j === 0) continue;
      current.push(seg.geometry[j]!);
    }
  }
  if (current.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: current },
      properties: {}
    });
  }
  return features;
}

/** Distance from a point to a polyline (in whatever coordinate space the inputs are). */
export function distToPolyline(
  px: number,
  py: number,
  coords: Array<[number, number]>
): number {
  let minDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i]!;
    const [bx, by] = coords[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** Find the nearest segment index to a screen point using pixel-space distance. */
export function findNearestSegment(
  mapInstance: MapGL,
  data: RouteData,
  lon: number,
  lat: number
): number {
  const clickPx = mapInstance.project([lon, lat]);
  const toScreen = (c: [number, number]): [number, number] => {
    const p = mapInstance.project(c);
    return [p.x, p.y];
  };
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < data.segments.length; i++) {
    if (data.segments[i]!.method === 'none') continue;
    const screenCoords = data.segments[i]!.geometry.map(toScreen);
    const dist = distToPolyline(clickPx.x, clickPx.y, screenCoords);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

interface SegmentPopupOpts {
  map: MapGL;
  lngLat: [number, number];
  currentMethod: RouteSegment['method'];
  onSelect: (method: RouteSegment['method']) => void;
}

/** Create the segment routing method popup element. */
export function createSegmentPopup(opts: SegmentPopupOpts): HTMLElement {
  const px = opts.map.project(opts.lngLat);

  const el = document.createElement('div');
  el.className = 'route-edit-popup';
  el.innerHTML = [
    '<button data-method="straight">Straight</button>',
    ...(HAS_ROUTING
      ? [
          '<button data-method="driving">Drive</button>',
          '<button data-method="hiking">Hike</button>'
        ]
      : []),
    '<button data-method="none">None</button>'
  ].join('');

  el.style.cssText =
    `position:absolute;left:${px.x}px;top:${px.y}px;transform:translate(-50%,-100%) translateY(-8px);` +
    'background:rgba(44,44,46,0.95);border-radius:8px;padding:4px;display:flex;gap:2px;z-index:1500;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.5)';

  const buttons = Array.from(el.querySelectorAll('button'));
  for (const btn of buttons) {
    btn.style.cssText =
      'background:none;border:none;color:#e5e5e7;padding:6px 10px;border-radius:6px;' +
      'font:12px/1 -apple-system,sans-serif;cursor:pointer;white-space:nowrap';
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255,255,255,0.1)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'none';
    });
    btn.addEventListener('click', (ev: MouseEvent) => {
      ev.stopPropagation();
      opts.onSelect(btn.dataset.method as RouteSegment['method']);
    });
  }

  // Highlight current method
  const activeBtn = el.querySelector<HTMLElement>(
    `[data-method="${opts.currentMethod}"]`
  );
  if (activeBtn !== null) {
    activeBtn.style.background = 'rgba(96,165,250,0.3)';
  }

  return el;
}

/** Fetch routed geometry from the server for a segment. */
export async function fetchRouteGeometry(
  start: [number, number],
  end: [number, number],
  profile: string
): Promise<Array<[number, number]> | null> {
  try {
    const resp = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [start, end], profile })
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      geometry: { coordinates: Array<[number, number]> };
    };
    return data.geometry.coordinates;
  } catch {
    return null;
  }
}

/** Re-route a single segment in-place using the routing API. */
export async function rerouteSegment(
  routeData: RouteData,
  segIdx: number
): Promise<void> {
  const seg = routeData.segments[segIdx];
  if (seg === undefined || seg.method === 'straight' || seg.method === 'none') {
    return;
  }

  const startPt = routeData.points[segIdx]!;
  const endPt = routeData.points[segIdx + 1]!;
  const coords = HAS_ROUTING
    ? await fetchRouteGeometry(
        [startPt.lon, startPt.lat],
        [endPt.lon, endPt.lat],
        seg.method
      )
    : null;
  if (coords === null && !HAS_ROUTING) {
    // Routing unavailable: downgrade the saved method so it stays consistent.
    seg.method = 'straight';
  }
  seg.geometry = coords ?? [
    [startPt.lon, startPt.lat],
    [endPt.lon, endPt.lat]
  ];
}

/** Insert a waypoint into routeData at the given segment, splitting it. */
export function insertWaypointInRoute(
  data: RouteData,
  segIdx: number,
  lon: number,
  lat: number
): void {
  const newPoint: RoutePoint = { type: 'waypoint', lon, lat };
  data.points.splice(segIdx + 1, 0, newPoint);

  const oldSeg = data.segments[segIdx]!;
  const prevPt = data.points[segIdx]!;
  const nextPt = data.points[segIdx + 2]!;
  const seg1: RouteSegment = {
    method: oldSeg.method,
    geometry: [
      [prevPt.lon, prevPt.lat],
      [lon, lat]
    ]
  };
  const seg2: RouteSegment = {
    method: oldSeg.method,
    geometry: [
      [lon, lat],
      [nextPt.lon, nextPt.lat]
    ]
  };
  data.segments.splice(segIdx, 1, seg1, seg2);
}

/** Change a segment's routing method. Returns false if the routing API call failed. */
export async function applySegmentMethod(
  data: RouteData,
  segIdx: number,
  method: RouteSegment['method']
): Promise<boolean> {
  const seg = data.segments[segIdx];
  if (seg === undefined) return false;

  const prevMethod = seg.method;
  const prevGeometry = seg.geometry;
  seg.method = method;

  if (method === 'straight' || method === 'none') {
    const startPt = data.points[segIdx]!;
    const endPt = data.points[segIdx + 1]!;
    seg.geometry = [
      [startPt.lon, startPt.lat],
      [endPt.lon, endPt.lat]
    ];
    return true;
  }

  const startPt = data.points[segIdx]!;
  const endPt = data.points[segIdx + 1]!;
  const coords = await fetchRouteGeometry(
    [startPt.lon, startPt.lat],
    [endPt.lon, endPt.lat],
    method
  );
  if (coords === null) {
    // Revert on failure
    seg.method = prevMethod;
    seg.geometry = prevGeometry;
    return false;
  }
  seg.geometry = coords;
  return true;
}

/** Remove a waypoint from routeData, merging adjacent segments. Returns the merge method. */
export function removeWaypointFromRoute(
  data: RouteData,
  pointIdx: number
): RouteSegment['method'] | null {
  if (data.points[pointIdx]?.type !== 'waypoint') return null;

  const segBefore = pointIdx - 1;
  const prevPt = data.points[pointIdx - 1]!;
  const nextPt = data.points[pointIdx + 1]!;
  const method = data.segments[segBefore]?.method ?? 'straight';

  data.points.splice(pointIdx, 1);
  const merged: RouteSegment = {
    method,
    geometry: [
      [prevPt.lon, prevPt.lat],
      [nextPt.lon, nextPt.lat]
    ]
  };
  data.segments.splice(segBefore, 2, merged);
  return method;
}
