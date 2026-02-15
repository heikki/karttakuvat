import type maplibregl from 'maplibre-gl';
import { NightLayer } from 'maplibre-gl-nightlayer';

import { toUtcSortKey } from './utils';

let nightLayer = createNightLayer();
let nightLayerDate: Date | null = null;
let nightAnimationId: number | null = null;
let nightLayerAlbums: string[] = [];
let nightLayerHidden = false;

function createNightLayer(date: Date | null = null): NightLayer {
  return new NightLayer({
    date,
    opacity: 0.8,
    color: [0, 0, 0, 255],
    daytimeColor: [0, 0, 0, 0],
    twilightSteps: 0,
    updateInterval: 0
  });
}

function updateNightLayerVisibility(map: maplibregl.Map) {
  if (map.getLayer(nightLayer.id) === undefined) return;
  const visible = map.getProjection().type === 'globe' && !nightLayerHidden;
  nightLayer.setOpacity(visible ? 0.8 : 0);
}

export function addNightLayer(map: maplibregl.Map, insertBefore?: string) {
  if (map.getLayer(nightLayer.id) !== undefined) {
    map.removeLayer(nightLayer.id);
  }
  nightLayer = createNightLayer(nightLayerDate);
  if (insertBefore !== undefined && map.getLayer(insertBefore) !== undefined) {
    map.addLayer(nightLayer, insertBefore);
  } else {
    map.addLayer(nightLayer);
  }
  updateNightLayerVisibility(map);
}

export function onProjectionChange(map: maplibregl.Map) {
  updateNightLayerVisibility(map);
}

export function setNightLayerHidden(hidden: boolean) {
  nightLayerHidden = hidden;
  nightLayer.setOpacity(hidden ? 0 : 0.8);
}

export function resetNightLayer(map: maplibregl.Map) {
  if (nightAnimationId !== null) {
    cancelAnimationFrame(nightAnimationId);
    nightAnimationId = null;
  }
  nightLayerDate = null;
  nightLayerAlbums = [];
  nightLayer.setDate(new Date());
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
    nightLayer.setDate(d);
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
    nightLayer.setDate(targetDate);
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
