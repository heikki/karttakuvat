import maplibregl from 'maplibre-gl';

import {
  addPendingEdit,
  addPendingTimeEdit,
  copyDate,
  copyLocation,
  getCopiedDate,
  getCopiedLocation,
  setPendingTimeEdit,
  state
} from './data';
import {
  buildDateRangeString,
  buildPopupContent,
  buildSinglePopupHtml,
  buildThumbsHtml,
  computeManualDateOffset,
  getEffectiveDate,
  getEffectiveLocation,
  groupInfoHtml,
  singleInfoHtml,
  updateInfoOverlay,
  updatePhotosLink,
  updateVideoIndicator
} from './popup-html';
import type { Photo } from './types';
import { updateLightboxGroup } from './ui';
import {
  compareDates,
  computeFullDatetimeOffsetHours,
  getThumbUrl,
  parseExifDate,
  parseUserDatetime
} from './utils';

// State
let currentPopup: maplibregl.Popup | null = null;
let clusterPhotos: Photo[] = [];
let currentSinglePhotoIndex: number | null = null;
let currentPhotoUuid: string | null = null;
let currentGroupIndex = 0;
let dateEditMode = false;
let onPhotoChangeFn: (uuid: string | null) => void = () => {
  /* noop */
};

// Callbacks that will be set by map.ts
let highlightMarkerFn: (index: number | null) => void = () => {
  /* noop */
};
let panToFitPopupFn: (coords: [number, number]) => void = () => {
  /* noop */
};
let getMapFn: () => maplibregl.Map | undefined = () => undefined;
let updateSunPositionFn: (
  dateStr: string,
  tz: string | null,
  albums?: string[]
) => void = () => {
  /* noop */
};

export function initPopupCallbacks(
  highlightMarker: (index: number | null) => void,
  panToFitPopup: (coords: [number, number]) => void,
  getMap: () => maplibregl.Map,
  updateSunPosition: (
    dateStr: string,
    tz: string | null,
    albums?: string[]
  ) => void
) {
  highlightMarkerFn = highlightMarker;
  panToFitPopupFn = panToFitPopup;
  getMapFn = getMap;
  updateSunPositionFn = updateSunPosition;
}

export function getCurrentPopup(): maplibregl.Popup | null {
  return currentPopup;
}

export function getClusterPhotos(): Photo[] {
  return clusterPhotos;
}

export function getCurrentGroupIndex(): number {
  return currentGroupIndex;
}

export function getCurrentSinglePhotoIndex(): number | null {
  return currentSinglePhotoIndex;
}

export function getCurrentPhotoUuid(): string | null {
  return currentPhotoUuid;
}

export function setCurrentSinglePhotoIndex(index: number | null) {
  currentSinglePhotoIndex = index;
}

export function setOnPhotoChange(fn: (uuid: string | null) => void) {
  onPhotoChangeFn = fn;
}

export function isDateEditMode(): boolean {
  return dateEditMode;
}

function getCurrentPhoto(): Photo | undefined {
  if (currentSinglePhotoIndex !== null) {
    return state.filteredPhotos[currentSinglePhotoIndex];
  }
  if (clusterPhotos.length > 0) {
    return clusterPhotos[currentGroupIndex];
  }
  return undefined;
}

export interface FeatureProps {
  index: number;
}

function shouldShowPasteLink(photo: Photo): boolean {
  const copied = getCopiedLocation();
  if (copied === null) return false;
  const loc = getEffectiveLocation(photo);
  if (loc === null) return true;
  return copied.lat !== loc.lat || copied.lon !== loc.lon;
}

function updatePasteLink(index: number) {
  const pasteLink = document.getElementById('single-paste-location');
  if (pasteLink === null) return;
  const photo = state.filteredPhotos[index];
  if (photo === undefined) return;
  pasteLink.style.display = shouldShowPasteLink(photo) ? '' : 'none';
  pasteLink.onclick = (ev) => {
    ev.preventDefault();
    pasteLocation(index);
  };
}

export function showPopup(props: FeatureProps, coords: [number, number]) {
  if (currentPopup !== null) {
    currentPopup.remove();
  }

  const map = getMapFn();
  if (map === undefined) return;

  const index = props.index;
  const photo = state.filteredPhotos[index];
  if (photo === undefined) return;

  dateEditMode = false;
  currentSinglePhotoIndex = index;
  currentPhotoUuid = photo.uuid;
  clusterPhotos = [];
  highlightMarkerFn(index);
  onPhotoChangeFn(photo.uuid);
  updateSunPositionFn(photo.date, photo.tz ?? null, photo.albums);

  currentPopup = new maplibregl.Popup({
    closeButton: false,
    maxWidth: '320px',
    anchor: 'bottom',
    offset: [0, -12]
  })
    .setLngLat(coords)
    .setHTML(buildSinglePopupHtml(photo, index, dateEditMode))
    .addTo(map);

  updatePasteLink(index);

  currentPopup.on('close', () => {
    dateEditMode = false;
    highlightMarkerFn(null);
    currentSinglePhotoIndex = null;
    currentPhotoUuid = null;
    onPhotoChangeFn(null);
  });

  panToFitPopupFn(coords);
}

export interface MapFeature {
  properties: Record<string, unknown>;
}

export function showMultiPhotoPopup(
  features: MapFeature[],
  coords: [number, number],
  keepSelection: boolean,
  clearSelectionFn: () => void
) {
  if (currentPopup !== null) {
    currentPopup.remove();
  }
  dateEditMode = false;
  currentSinglePhotoIndex = null;

  const map = getMapFn();
  if (map === undefined) return;

  if (!keepSelection) {
    clearSelectionFn();
  }

  clusterPhotos = features
    .map((f) => {
      const idx = f.properties.index as number;
      const photo = state.filteredPhotos[idx];
      if (photo === undefined) return undefined;
      const p: Photo = { ...photo, _index: idx };
      return p;
    })
    .filter((p): p is Photo => p !== undefined);

  if (clusterPhotos.length === 0) return;

  updateLightboxGroup(clusterPhotos);

  clusterPhotos.sort(compareDates);
  currentGroupIndex = 0;
  highlightMarkerFn(clusterPhotos[0]!._index ?? 0);

  const firstPhoto = clusterPhotos[0]!;
  const lastPhoto = clusterPhotos[clusterPhotos.length - 1];
  const dateRangeStr = buildDateRangeString(firstPhoto, lastPhoto);
  const thumbsHtml = buildThumbsHtml(clusterPhotos);

  const popupContent = buildPopupContent(
    clusterPhotos,
    firstPhoto,
    dateRangeStr,
    thumbsHtml
  );

  currentPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    maxWidth: '400px',
    anchor: 'bottom',
    offset: [0, -12]
  })
    .setLngLat(coords)
    .setHTML(popupContent)
    .addTo(map);

  currentPopup.on('close', () => {
    dateEditMode = false;
    clearSelectionFn();
    highlightMarkerFn(null);
    clusterPhotos = [];
  });

  if (!keepSelection) {
    panToFitPopupFn(coords);
  }
}

export function selectGroupPhoto(index: number) {
  const photo = clusterPhotos[index];
  if (photo === undefined) return;

  dateEditMode = false;

  const mainImg = document.getElementById(
    'group-main-img'
  ) as HTMLImageElement | null;
  const info = document.getElementById('group-info');

  if (mainImg !== null) {
    mainImg.src = getThumbUrl(photo);
    mainImg.onclick = () => {
      window.showGroupLightbox(index);
    };
  }
  if (info !== null) {
    info.innerHTML = groupInfoHtml(photo, dateEditMode);
  }
  updatePhotosLink('group-photos-link', photo);
  updateVideoIndicator(photo);
  updateInfoOverlay(photo);

  document.querySelectorAll('.photo-popup .thumb').forEach((thumb, i) => {
    thumb.classList.toggle('active', i === index);
  });

  highlightMarkerFn(photo._index ?? null);
  updateSunPositionFn(photo.date, photo.tz ?? null, photo.albums);
  currentGroupIndex = index;
}

export function scrollToActiveThumbnail() {
  const activeThumb = document.querySelector('.photo-popup .thumb.active');
  if (activeThumb !== null) {
    activeThumb.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    });
  }
}

function refreshDateRow() {
  if (currentSinglePhotoIndex !== null) {
    const photo = state.filteredPhotos[currentSinglePhotoIndex];
    if (photo === undefined) return;
    const singleInfo = document.getElementById('single-info');
    if (singleInfo !== null) {
      singleInfo.innerHTML = singleInfoHtml(
        photo,
        currentSinglePhotoIndex,
        dateEditMode
      );
      updatePasteLink(currentSinglePhotoIndex);
    }
  } else if (clusterPhotos.length > 0) {
    const photo = clusterPhotos[currentGroupIndex];
    if (photo === undefined) return;
    const groupInfo = document.getElementById('group-info');
    if (groupInfo !== null) {
      groupInfo.innerHTML = groupInfoHtml(photo, dateEditMode);
    }
  }
}

export function adjustTime(uuid: string, hours: number) {
  addPendingTimeEdit(uuid, hours);
  const singleInfo = document.getElementById('single-info');
  if (singleInfo !== null && currentSinglePhotoIndex !== null) {
    const photo = state.filteredPhotos[currentSinglePhotoIndex];
    if (photo?.uuid === uuid) {
      singleInfo.innerHTML = singleInfoHtml(
        photo,
        currentSinglePhotoIndex,
        dateEditMode
      );
      updatePasteLink(currentSinglePhotoIndex);
    }
  }
  const groupInfo = document.getElementById('group-info');
  if (groupInfo !== null && clusterPhotos.length > 0) {
    const photo = clusterPhotos[currentGroupIndex];
    if (photo?.uuid === uuid) {
      groupInfo.innerHTML = groupInfoHtml(photo, dateEditMode);
    }
  }
}

export function copyLocationFromPopup(lat: number, lon: number) {
  copyLocation(lat, lon);
  if (currentSinglePhotoIndex !== null) {
    updatePasteLink(currentSinglePhotoIndex);
  }
}

export function pasteLocation(photoIndex: number) {
  const photo = state.filteredPhotos[photoIndex];
  const copied = getCopiedLocation();
  if (photo === undefined || copied === null) return;

  addPendingEdit(photo.uuid, copied.lat, copied.lon);
  showPopup({ index: photoIndex }, [copied.lon, copied.lat]);
}

export function copyDateFromPopup() {
  const photo = getCurrentPhoto();
  if (photo === undefined) return;
  const effectiveDate = getEffectiveDate(photo);
  if (effectiveDate === '') return;
  copyDate(effectiveDate);
  refreshDateRow();
}

export function pasteDateToPhoto() {
  const photo = getCurrentPhoto();
  if (photo === undefined) return;
  const copied = getCopiedDate();
  if (copied === null) return;
  const copiedDate = parseExifDate(copied);
  if (copiedDate === null) return;
  const offset = computeFullDatetimeOffsetHours(photo.date, copiedDate);
  if (offset === null) return;
  setPendingTimeEdit(photo.uuid, offset);
  refreshDateRow();
}

export function toggleDateEdit() {
  dateEditMode = !dateEditMode;
  refreshDateRow();
  if (dateEditMode) {
    const input = document.getElementById(
      'date-input'
    ) as HTMLInputElement | null;
    input?.focus();
  }
}

export function applyManualDate() {
  const photo = getCurrentPhoto();
  if (photo === undefined) return;
  const input = document.getElementById(
    'date-input'
  ) as HTMLInputElement | null;
  if (input === null || input.value.trim() === '') return;
  const yearStr = photo.date.split(':')[0];
  const fallbackYear =
    yearStr !== undefined && yearStr !== ''
      ? parseInt(yearStr, 10)
      : new Date().getFullYear();
  const parsed = parseUserDatetime(input.value, fallbackYear);
  if (parsed === null) return;
  const offset = computeManualDateOffset(photo.date, parsed);
  if (offset === null) return;
  setPendingTimeEdit(photo.uuid, offset);
  dateEditMode = false;
  refreshDateRow();
}

export function handleDateInputKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyManualDate();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    toggleDateEdit();
  }
}

export function navigateSinglePhoto(newIndex: number) {
  const photo = state.filteredPhotos[newIndex];
  if (photo === undefined || currentPopup === null) return;

  dateEditMode = false;
  currentSinglePhotoIndex = newIndex;
  currentPhotoUuid = photo.uuid;
  highlightMarkerFn(newIndex);
  onPhotoChangeFn(photo.uuid);
  updateSunPositionFn(photo.date, photo.tz ?? null, photo.albums);

  const img = document.getElementById('single-img') as HTMLImageElement | null;
  const info = document.getElementById('single-info');

  if (img !== null) {
    img.src = getThumbUrl(photo);
    img.onclick = () => {
      window.showLightbox(newIndex);
    };
  }
  if (info !== null) {
    info.innerHTML = singleInfoHtml(photo, newIndex, dateEditMode);
  }
  updatePhotosLink('single-photos-link', photo);
  updateVideoIndicator(photo);
  updateInfoOverlay(photo);

  updatePasteLink(newIndex);

  const loc = getEffectiveLocation(photo);
  const lng = loc?.lon ?? 0;
  const lat = loc?.lat ?? 0;
  currentPopup.setLngLat([lng, lat]);
  panToFitPopupFn([lng, lat]);
}
