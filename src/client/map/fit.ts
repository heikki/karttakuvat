import { LngLatBounds } from 'maplibre-gl';
import type { Map as MapGL } from 'maplibre-gl';

import { state } from '@common/data';
import { FitToPhotosEvent } from '@common/events';
import { mapViewFromUrl } from '@common/filter-url';

import popup from './popup';
import selection from './selection';

// eslint-disable-next-line @typescript-eslint/init-declarations -- set in init
let map: MapGL;

function init(m: MapGL) {
  map = m;
  document.addEventListener(FitToPhotosEvent.type, (e) => {
    toPhotos(e.animate, e.selectFirst);
  });
  if (mapViewFromUrl() === null) {
    m.on('load', () => {
      if (state.filteredPhotos.length > 0) toPhotos();
    });
  }
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
  const selectedUuid = selection.getPhotoUuid();
  if (selectedUuid === photos[oldestIdx]!.uuid) {
    selection.openPopup(photos[newestIdx]!.uuid);
  } else if (selectedUuid === photos[newestIdx]!.uuid) {
    selection.openPopup(photos[oldestIdx]!.uuid);
  } else if (selectedUuid === null) {
    selection.openPopup(photos[oldestIdx]!.uuid);
  }
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
  const popupEl = popup.get()?.getElement();
  if (popupEl === undefined) return 50;
  return Math.max(50, popupEl.getBoundingClientRect().height + 60);
}

function toPhotos(animate = false, selectFirst = false) {
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

export default { init, toPhotos };
