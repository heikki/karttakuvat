import { LngLatBounds } from 'maplibre-gl';
import type { Map as MapGL } from 'maplibre-gl';

import { state } from '@common/data';
import { FitToPhotosEvent } from '@common/events';

import { getPhotoUuid, getPopup, showPopup } from './popup';

// eslint-disable-next-line @typescript-eslint/init-declarations -- set in initFit
let map: MapGL;

export function initFit(m: MapGL) {
  map = m;
  document.addEventListener(FitToPhotosEvent.type, (e) => {
    fitToPhotos(e.animate, e.selectFirst);
  });
}

function showOldestOrNewestPopup() {
  const photos = state.filteredPhotos;
  if (photos.length === 0) return;
  const oldestIdx = photos.reduce(
    (min, p, i) => (p.date < photos[min]!.date ? i : min),
    0
  );
  const newestIdx = photos.reduce(
    (max, p, i) => (p.date > photos[max]!.date ? i : max),
    0
  );
  const target =
    getPhotoUuid() === photos[oldestIdx]?.uuid ? newestIdx : oldestIdx;
  showPopup(target);
}

function computePhotoBounds(): LngLatBounds {
  const bounds = new LngLatBounds();
  state.filteredPhotos.forEach((p) => bounds.extend([p.lon ?? 0, p.lat ?? 0]));
  return bounds;
}

function isSinglePointBounds(bounds: LngLatBounds): boolean {
  return (
    bounds.getSouthWest().lng === bounds.getNorthEast().lng &&
    bounds.getSouthWest().lat === bounds.getNorthEast().lat
  );
}

function triggerPostFitActions(animate: boolean, selectFirst: boolean) {
  if (animate && selectFirst) {
    void map.once('moveend', showOldestOrNewestPopup);
  } else if (selectFirst) {
    showOldestOrNewestPopup();
  }
}

function computeTopPadding(): number {
  if (map.getProjection().type !== 'globe') return 350;
  const popupEl = getPopup()?.getElement();
  if (popupEl === undefined) return 50;
  return Math.max(50, popupEl.getBoundingClientRect().height + 60);
}

export function fitToPhotos(animate = false, selectFirst = false) {
  if (state.filteredPhotos.length === 0) return;
  const bounds = computePhotoBounds();
  const duration = animate ? 500 : 0;

  if (isSinglePointBounds(bounds)) {
    const center = bounds.getCenter();
    map.flyTo({ center: [center.lng, center.lat], zoom: 14, duration });
    triggerPostFitActions(animate, selectFirst);
    return;
  }

  map.fitBounds(bounds, {
    padding: { top: computeTopPadding(), bottom: 40, left: 50, right: 270 },
    maxZoom: 18,
    duration
  });
  triggerPostFitActions(animate, selectFirst);
}
