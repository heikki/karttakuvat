import { LngLatBounds } from 'maplibre-gl';
import type { Map as MapGL } from 'maplibre-gl';

import { state } from '@common/data';
import { FitToPhotosEvent } from '@common/events';

import { getPopup, showPopup } from './popup';

// eslint-disable-next-line @typescript-eslint/init-declarations -- set in initFit
let map: MapGL;

export function initFit(m: MapGL) {
  map = m;
  document.addEventListener(FitToPhotosEvent.type, (e) => {
    fitToPhotos(e.animate, e.selectFirst);
  });
}

function showFirstPopup() {
  if (state.filteredPhotos[0] === undefined) return;
  showPopup(0);
}

function showLatestPopup() {
  if (state.filteredPhotos.length === 0) return;
  let latestIndex = 0;
  let latestDate = state.filteredPhotos[0]?.date ?? '';
  for (let i = 1; i < state.filteredPhotos.length; i++) {
    const d = state.filteredPhotos[i]?.date ?? '';
    if (d > latestDate) {
      latestDate = d;
      latestIndex = i;
    }
  }
  showPopup(latestIndex);
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

function triggerPostFitActions(
  animate: boolean,
  selectFirst: boolean,
  selectLatest: boolean
) {
  const show = selectLatest ? showLatestPopup : showFirstPopup;
  if (animate && (selectFirst || selectLatest)) {
    void map.once('moveend', show);
  } else if (selectFirst || selectLatest) {
    show();
  }
}

function computeTopPadding(): number {
  if (map.getProjection().type !== 'globe') return 350;
  const popupEl = getPopup()?.getElement();
  if (popupEl === undefined) return 50;
  return Math.max(50, popupEl.getBoundingClientRect().height + 60);
}

export function fitToPhotos(
  animate = false,
  selectFirst = false,
  selectLatest = false
) {
  if (state.filteredPhotos.length === 0) return;
  const bounds = computePhotoBounds();
  const duration = animate ? 500 : 0;

  if (isSinglePointBounds(bounds)) {
    const center = bounds.getCenter();
    map.flyTo({ center: [center.lng, center.lat], zoom: 14, duration });
    triggerPostFitActions(animate, selectFirst, selectLatest);
    return;
  }

  map.fitBounds(bounds, {
    padding: { top: computeTopPadding(), bottom: 40, left: 50, right: 270 },
    maxZoom: 18,
    duration
  });
  triggerPostFitActions(animate, selectFirst, selectLatest);
}
