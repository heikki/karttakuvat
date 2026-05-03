import * as data from '@common/data';
import * as edits from '@common/edits';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';

import type { RouteData, RoutePoint, RouteSegment } from '.';

function makeStraightSegment(from: RoutePoint, to: RoutePoint): RouteSegment {
  return {
    method: 'straight',
    geometry: [
      [from.lon, from.lat],
      [to.lon, to.lat]
    ]
  };
}

function buildPhotoLocationMap(
  photos: Photo[]
): Map<string, { lon: number; lat: number }> {
  const m = new Map<string, { lon: number; lat: number }>();
  for (const photo of photos) {
    const loc = edits.getEffectiveLocation(photo);
    if (loc !== null) m.set(photo.uuid, loc);
  }
  return m;
}

function buildPhotoSortKeys(photos: Photo[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const photo of photos) {
    if (photo.date !== '') {
      m.set(photo.uuid, toUtcSortKey(edits.getEffectiveDate(photo), photo.tz));
    }
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

/** Remove point at index k, merging the surrounding segments. */
function removePointAt(route: RouteData, k: number): void {
  const { points, segments } = route;
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
  route: RouteData,
  idx: number
): { idx: number; removed: boolean } {
  const { points } = route;
  let cur = idx;
  let removed = false;
  if (cur + 1 < points.length && points[cur + 1]!.type === 'waypoint') {
    removePointAt(route, cur + 1);
    removed = true;
  }
  if (cur > 0 && points[cur - 1]!.type === 'waypoint') {
    removePointAt(route, cur - 1);
    cur -= 1;
    removed = true;
  }
  return { idx: cur, removed };
}

/** Insert a point at index k, building straight-line segments to neighbors. */
function insertPointAt(route: RouteData, k: number, pt: RoutePoint): void {
  const { points, segments } = route;
  if (points.length === 0) {
    points.push(pt);
    return;
  }
  if (k <= 0) {
    segments.unshift(makeStraightSegment(pt, points[0]!));
    points.unshift(pt);
    return;
  }
  if (k >= points.length) {
    segments.push(makeStraightSegment(points[points.length - 1]!, pt));
    points.push(pt);
    return;
  }
  const prev = points[k - 1]!;
  const next = points[k]!;
  points.splice(k, 0, pt);
  segments.splice(
    k - 1,
    1,
    makeStraightSegment(prev, pt),
    makeStraightSegment(pt, next)
  );
}

function resetSegmentsAroundIndex(
  route: RouteData,
  idx: number,
  pt: RoutePoint
): void {
  const { points, segments } = route;
  if (idx > 0 && idx - 1 < segments.length) {
    segments[idx - 1] = makeStraightSegment(points[idx - 1]!, pt);
  }
  const next = points[idx + 1];
  if (idx < segments.length && next !== undefined) {
    segments[idx] = makeStraightSegment(pt, next);
  }
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

/**
 * Sync photo point coordinates in route data with current effective locations.
 * When a photo's coord changes, splice any waypoint immediately before or
 * after it (likely stale). Returns true if any waypoint was removed.
 */
export function syncPhotoPoints(
  route: RouteData,
  photos: Photo[] = data.filteredPhotos.get()
): boolean {
  const locMap = buildPhotoLocationMap(photos);
  const { points, segments } = route;
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
    const result = removeAdjacentWaypoints(route, i);
    if (result.removed) removed = true;
    i = result.idx + 1;
  }
  return removed;
}

/**
 * Reorder photo points in route data to match current chronological order.
 * Segments adjacent to moved points are reset to straight-line, and waypoints
 * adjacent to moved points are spliced (likely stale after the swap).
 * Returns true if any reordering occurred.
 */
export function reorderRoutePhotoPoints(
  route: RouteData,
  photos: Photo[] = data.filteredPhotos.get()
): boolean {
  const sortKeys = buildPhotoSortKeys(photos);
  const { points } = route;
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
    resetSegmentsAroundIndex(route, idx, newPt);
    movedIndices.push(idx);
  }

  for (let i = movedIndices.length - 1; i >= 0; i--) {
    removeAdjacentWaypoints(route, movedIndices[i]!);
  }

  return true;
}

/** Drop photo points whose uuid is no longer eligible (missing from album, or
 *  lost their location/date). Merges surrounding segments into straight lines. */
function dropOrphanPhotoPoints(
  route: RouteData,
  eligibleUuids: Set<string>
): boolean {
  let changed = false;
  for (let i = route.points.length - 1; i >= 0; i--) {
    const pt = route.points[i]!;
    if (
      pt.type === 'photo' &&
      pt.uuid !== undefined &&
      !eligibleUuids.has(pt.uuid)
    ) {
      removePointAt(route, i);
      changed = true;
    }
  }
  return changed;
}

interface InsertPlan {
  atIndex: number;
  pt: RoutePoint;
  sortKey: string;
}

interface Anchor {
  index: number;
  sortKey: string;
}

function findMissingPhotos(route: RouteData, eligible: Photo[]): Photo[] {
  const inRoute = new Set<string>();
  for (const pt of route.points) {
    if (pt.type === 'photo' && pt.uuid !== undefined) inRoute.add(pt.uuid);
  }
  return eligible.filter((p) => !inRoute.has(p.uuid));
}

function buildAnchorList(
  route: RouteData,
  sortKeyByUuid: Map<string, string>
): Anchor[] {
  const anchors: Anchor[] = [];
  for (let i = 0; i < route.points.length; i++) {
    const pt = route.points[i]!;
    if (pt.type === 'photo' && pt.uuid !== undefined) {
      const sk = sortKeyByUuid.get(pt.uuid);
      if (sk !== undefined) anchors.push({ index: i, sortKey: sk });
    }
  }
  return anchors;
}

function planInsertions(
  route: RouteData,
  missing: Photo[],
  anchors: Anchor[],
  sortKeyByUuid: Map<string, string>
): InsertPlan[] {
  const plans: InsertPlan[] = missing.map((m) => {
    const sk = sortKeyByUuid.get(m.uuid)!;
    const loc = edits.getEffectiveLocation(m)!;
    const next = anchors.find((a) => a.sortKey >= sk);
    const atIndex = next === undefined ? route.points.length : next.index;
    return {
      atIndex,
      pt: { type: 'photo', uuid: m.uuid, lon: loc.lon, lat: loc.lat },
      sortKey: sk
    };
  });
  // Apply back-to-front by atIndex; within same atIndex, larger sortKey first
  // so the lowest sortKey ends up at the lowest final index.
  plans.sort((a, b) => {
    if (a.atIndex !== b.atIndex) return b.atIndex - a.atIndex;
    return a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0;
  });
  return plans;
}

/** Insert photo points for eligible photos that aren't yet in the route,
 *  placed at chronologically correct positions with straight-line segments. */
function insertMissingPhotoPoints(
  route: RouteData,
  eligible: Photo[]
): boolean {
  if (eligible.length === 0) return false;
  const missing = findMissingPhotos(route, eligible);
  if (missing.length === 0) return false;

  const sortKeyByUuid = new Map<string, string>();
  for (const p of eligible) {
    sortKeyByUuid.set(p.uuid, toUtcSortKey(edits.getEffectiveDate(p), p.tz));
  }
  const anchors = buildAnchorList(route, sortKeyByUuid);
  const plans = planInsertions(route, missing, anchors, sortKeyByUuid);
  for (const plan of plans) {
    insertPointAt(route, plan.atIndex, plan.pt);
  }
  return true;
}

/**
 * Reconcile a saved route against the current state of an album: drop photo
 * points no longer eligible, sync coordinates of existing points, insert
 * newly eligible photos at chronological positions, and reorder by date.
 * Returns true if the route's structure changed (and should be persisted).
 */
export function reconcileRouteWithAlbum(
  route: RouteData,
  albumPhotos: Photo[]
): boolean {
  const eligible = albumPhotos.filter(
    (p) => edits.getEffectiveLocation(p) !== null && p.date !== ''
  );
  const eligibleUuids = new Set(eligible.map((p) => p.uuid));

  let changed = false;
  if (dropOrphanPhotoPoints(route, eligibleUuids)) changed = true;
  if (syncPhotoPoints(route, eligible)) changed = true;
  if (insertMissingPhotoPoints(route, eligible)) changed = true;
  if (reorderRoutePhotoPoints(route, eligible)) changed = true;
  return changed;
}
