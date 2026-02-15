import type maplibregl from 'maplibre-gl';

import { setGlobeRadius } from './globe-background';

// Destination point on sphere given start, bearing (deg), angular distance (rad)
function destPoint(
  lat: number,
  lng: number,
  bearing: number,
  dist: number
): [number, number] {
  const R = Math.PI / 180;
  const lat1 = lat * R;
  const brng = bearing * R;
  const sd = Math.sin(dist);
  const cd = Math.cos(dist);
  const sl = Math.sin(lat1);
  const cl = Math.cos(lat1);
  const lat2 = Math.asin(sl * cd + cl * sd * Math.cos(brng));
  const lng2 =
    lng * R + Math.atan2(Math.sin(brng) * sd * cl, cd - sl * Math.sin(lat2));
  return [lng2 / R, lat2 / R];
}

export function updateGlobeRadius(map: maplibregl.Map) {
  if (map.getProjection().type !== 'globe') return;
  const center = map.getCenter();
  const centerPx = map.project(center);
  // Project 4 points exactly 90° away on the sphere at cardinal bearings.
  // These land on the visible horizon regardless of globe orientation.
  const HALF_PI = Math.PI / 2;
  let radiusPx = 0;
  for (const b of [0, 90, 180, 270]) {
    const [lng, lat] = destPoint(center.lat, center.lng, b, HALF_PI);
    const px = map.project([lng, lat]);
    const dx = px.x - centerPx.x;
    const dy = px.y - centerPx.y;
    radiusPx = Math.max(radiusPx, Math.sqrt(dx * dx + dy * dy));
  }
  const canvas = map.getCanvas();
  const minDim = Math.min(canvas.clientWidth, canvas.clientHeight);
  setGlobeRadius(radiusPx, minDim);
}
