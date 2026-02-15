import type maplibregl from 'maplibre-gl';

import type { PhotoGlowLayer } from './glow-layer';
import { toUtcSortKey } from './utils';

let glowLayer: PhotoGlowLayer | null = null;
let nightLayerDate: Date | null = null;
let nightAnimationId: number | null = null;
let nightLayerAlbums: string[] = [];
let mapRef: maplibregl.Map | null = null;

export function setGlowLayer(layer: PhotoGlowLayer | null, map?: maplibregl.Map) {
  glowLayer = layer;
  if (map !== undefined) mapRef = map;
  if (glowLayer !== null && nightLayerDate !== null) {
    glowLayer.setNightDate(nightLayerDate);
  }
}

export function onProjectionChange(_map: maplibregl.Map) {
  // Night visibility is handled inside the glow layer's render() based on projection type
  mapRef?.triggerRepaint();
}

export function setNightLayerHidden(hidden: boolean) {
  glowLayer?.setNightHidden(hidden);
}

export function resetNightLayer(map: maplibregl.Map) {
  if (nightAnimationId !== null) {
    cancelAnimationFrame(nightAnimationId);
    nightAnimationId = null;
  }
  nightLayerDate = null;
  nightLayerAlbums = [];
  glowLayer?.setNightDate(null);
  map.triggerRepaint();
}

function animateNightTransition(
  map: maplibregl.Map,
  startTime: number,
  endTime: number,
  duration: number
) {
  const animStart = performance.now();

  const animate = (now: number) => {
    const t = Math.min(1, (now - animStart) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    const interpolated = startTime + (endTime - startTime) * eased;
    const d = new Date(interpolated);
    nightLayerDate = d;
    glowLayer?.setNightDate(d);
    map.triggerRepaint();
    if (t < 1) {
      nightAnimationId = requestAnimationFrame(animate);
    } else {
      nightAnimationId = null;
    }
  };
  nightAnimationId = requestAnimationFrame(animate);
}

interface SunPositionOptions {
  map: maplibregl.Map;
  dateStr: string;
  tz: string | null;
  albums?: string[];
}

export function updateSunPosition(options: SunPositionOptions) {
  const { map, dateStr, tz, albums } = options;
  if (dateStr === '') return;
  const targetDate = new Date(toUtcSortKey(dateStr, tz));
  if (isNaN(targetDate.getTime())) return;

  if (nightAnimationId !== null) {
    cancelAnimationFrame(nightAnimationId);
    nightAnimationId = null;
  }

  const prevAlbums = nightLayerAlbums;
  nightLayerAlbums = albums ?? [];

  const currentDate = nightLayerDate;
  if (currentDate === null) {
    nightLayerDate = targetDate;
    glowLayer?.setNightDate(targetDate);
    map.triggerRepaint();
    return;
  }

  const fullDiffMs = Math.abs(targetDate.getTime() - currentDate.getTime());
  const sharesAlbum = prevAlbums.some((a) => nightLayerAlbums.includes(a));
  const endTime = targetDate.getTime();
  const startTime = sharesAlbum
    ? currentDate.getTime()
    : (() => {
        let t = new Date(targetDate).setHours(
          currentDate.getHours(),
          currentDate.getMinutes(),
          currentDate.getSeconds()
        );
        // Ensure shortened animation goes in the same direction as the real transition
        const realDirection = endTime - currentDate.getTime();
        const shortDirection = endTime - t;
        if (realDirection > 0 && shortDirection <= 0) {
          t -= 86400000;
        } else if (realDirection < 0 && shortDirection >= 0) {
          t += 86400000;
        }
        return t;
      })();

  const duration = fullDiffMs > 86400000 ? 2000 : 400;

  animateNightTransition(map, startTime, endTime, duration);
}
