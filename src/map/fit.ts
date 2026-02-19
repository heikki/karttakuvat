import { LngLatBounds } from 'maplibre-gl';
import type { Map as MapGL } from 'maplibre-gl';

import { getEffectiveCoords, state } from '@common/data';
import { getCurrentPopup, showPopup } from '@components/photo-popup/popup';

type GetMap = () => MapGL;

// eslint-disable-next-line @typescript-eslint/init-declarations -- set in initFit
let getMap: GetMap;

export function initFit(getter: GetMap) {
  getMap = getter;
}

function showFirstPopup() {
  const photo = state.filteredPhotos[0];
  if (photo === undefined) return;
  const { lon, lat } = getEffectiveCoords(photo);
  showPopup({ index: 0 }, [lon, lat]);
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

function applyFitCallback(animate: boolean, selectFirst: boolean) {
  const map = getMap();
  if (animate && selectFirst) {
    void map.once('moveend', showFirstPopup);
  } else if (selectFirst) {
    showFirstPopup();
  }
}

function computeTopPadding(): number {
  const map = getMap();
  if (map.getProjection().type !== 'globe') return 350;
  const popupEl = getCurrentPopup()?.getElement();
  if (popupEl === undefined) return 50;
  return Math.max(50, popupEl.getBoundingClientRect().height + 60);
}

export function fitToPhotos(animate = false, selectFirst = false) {
  if (state.filteredPhotos.length === 0) return;
  const map = getMap();
  const bounds = computePhotoBounds();
  const duration = animate ? 500 : 0;

  if (isSinglePointBounds(bounds)) {
    const center = bounds.getCenter();
    map.flyTo({ center: [center.lng, center.lat], zoom: 14, duration });
    applyFitCallback(animate, selectFirst);
    return;
  }

  map.fitBounds(bounds, {
    padding: { top: computeTopPadding(), bottom: 40, left: 50, right: 270 },
    maxZoom: 18,
    duration
  });
  applyFitCallback(animate, selectFirst);
}
