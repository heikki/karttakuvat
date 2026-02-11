import maplibregl from 'maplibre-gl';

import {
  addPendingEdit,
  addPendingTimeEdit,
  applyHourOffset,
  copyDate,
  copyLocation,
  getCopiedDate,
  getCopiedLocation,
  setPendingTimeEdit,
  state
} from './data';
import type { Photo } from './types';
import { updateLightboxGroup } from './ui';
import {
  compareDates,
  computeDateOffsetHours,
  computeFullDatetimeOffsetHours,
  durationSpan,
  formatDate,
  formatLocation,
  getThumbUrl,
  isVideo,
  parseUserDatetime
} from './utils';

// State
let currentPopup: maplibregl.Popup | null = null;
let clusterPhotos: Photo[] = [];
let currentSinglePhotoIndex: number | null = null;
let currentPhotoUuid: string | null = null;
let currentGroupIndex = 0;
let dateEditMode = false;

// Callbacks that will be set by map.ts
let highlightMarkerFn: (index: number | null) => void = () => {
  /* noop */
};
let panToFitPopupFn: (coords: [number, number]) => void = () => {
  /* noop */
};
let getMapFn: () => maplibregl.Map | undefined = () => undefined;

export function initPopupCallbacks(
  highlightMarker: (index: number | null) => void,
  panToFitPopup: (coords: [number, number]) => void,
  getMap: () => maplibregl.Map
) {
  highlightMarkerFn = highlightMarker;
  panToFitPopupFn = panToFitPopup;
  getMapFn = getMap;
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

function getEffectiveDate(photo: Photo): string {
  const offset = state.pendingTimeEdits.get(photo.uuid) ?? 0;
  if (offset === 0) return photo.date;
  return applyHourOffset(photo.date, offset);
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

function shouldShowDatePaste(photo: Photo): boolean {
  const copied = getCopiedDate();
  if (copied === null) return false;
  const effectiveDate = getEffectiveDate(photo);
  if (effectiveDate === '') return false;
  const dayPart = effectiveDate.split(' ')[0];
  return dayPart !== copied;
}

function dateNormalButtonsHtml(photo: Photo): string {
  const pasteVisible = shouldShowDatePaste(photo);
  return `<span class="time-adjust-buttons"><button class="time-btn" onclick="event.preventDefault(); window.copyDateFromPopup()">copy</button><button class="time-btn" id="date-paste" onclick="event.preventDefault(); window.pasteDateToPhoto()"${pasteVisible ? '' : ' style="display:none"'}>paste</button><button class="time-btn" onclick="event.preventDefault(); window.toggleDateEdit()">edit</button></span>`;
}

function dateEditButtonsHtml(uuid: string): string {
  return `<span class="time-adjust-buttons"><button class="time-btn" onclick="event.preventDefault(); window.adjustTime('${uuid}', -24)">-1d</button><button class="time-btn" onclick="event.preventDefault(); window.adjustTime('${uuid}', 24)">+1d</button><button class="time-btn" onclick="event.preventDefault(); window.adjustTime('${uuid}', -1)">-1h</button><button class="time-btn" onclick="event.preventDefault(); window.adjustTime('${uuid}', 1)">+1h</button><button class="time-btn" onclick="event.preventDefault(); window.toggleDateEdit()">done</button></span>`;
}

function editableDateStr(exifDate: string): string {
  if (exifDate === '') return '';
  const [datePart, timePart] = exifDate.split(' ');
  if (datePart === undefined) return '';
  const parts = datePart.split(':');
  if (parts.length < 3) return '';
  const d = `${parseInt(parts[2]!, 10)}.${parseInt(parts[1]!, 10)}.${parts[0]!}`;
  if (timePart === undefined) return d;
  const [h, m] = timePart.split(':');
  if (h === undefined || m === undefined) return d;
  return `${d} ${h}:${m}`;
}

function dateLineHtml(photo: Photo): string {
  const dateText = formatDate(getEffectiveDate(photo), photo.tz);
  const duration = durationSpan(photo);
  if (dateEditMode) {
    const inputVal = editableDateStr(getEffectiveDate(photo));
    return `${dateText}${duration} ${dateEditButtonsHtml(photo.uuid)}<div class="date-edit-row"><input class="date-input" type="text" value="${inputVal}" placeholder="25.3. 14:30" id="date-input" onkeydown="window.handleDateInputKey(event)" /><button class="time-btn" onclick="event.preventDefault(); window.applyManualDate()">OK</button></div>`;
  }
  return `${dateText}${duration} ${dateNormalButtonsHtml(photo)}`;
}

export interface FeatureProps {
  index: number;
}

function getEffectiveLocation(
  photo: Photo
): { lat: number; lon: number } | null {
  const pending = state.pendingEdits.get(photo.uuid);
  if (pending !== undefined) {
    return pending;
  }
  if (photo.lat !== null && photo.lon !== null) {
    return { lat: photo.lat, lon: photo.lon };
  }
  return null;
}

function shouldShowPasteLink(photo: Photo): boolean {
  const copied = getCopiedLocation();
  if (copied === null) return false;
  const loc = getEffectiveLocation(photo);
  return loc === null || copied.lat !== loc.lat || copied.lon !== loc.lon;
}

function locationButtonsHtml(photo: Photo, index: number): string {
  const loc = getEffectiveLocation(photo);
  const copyBtn =
    loc === null
      ? ''
      : `<button class="loc-btn" onclick="event.preventDefault(); window.copyLocationFromPopup(${loc.lat}, ${loc.lon})">copy</button>`;
  const pasteVisible = shouldShowPasteLink(photo);
  const pasteBtn = `<button class="loc-btn" id="single-paste-location" onclick="event.preventDefault(); window.pasteLocation(${index})"${pasteVisible ? '' : ' style="display:none"'}>paste</button>`;
  return `<span class="loc-buttons"><button class="loc-btn" onclick="event.preventDefault(); window.enterPlacementMode(${index})">set</button>${copyBtn}${pasteBtn}</span>`;
}

function buildPhotosOverlay(id: string, photo: Photo): string {
  if (photo.photos_url !== undefined && photo.photos_url !== '') {
    return `<a class="photos-overlay-btn" id="${id}" href="${photo.photos_url}" target="_blank" tabindex="-1" onclick="event.stopPropagation()"></a>`;
  }
  return `<a class="photos-overlay-btn" id="${id}" href="#" target="_blank" tabindex="-1" onclick="event.stopPropagation()" style="display:none"></a>`;
}

function singleInfoHtml(photo: Photo, index: number): string {
  return `${dateLineHtml(photo)}<br>${formatLocation(photo)} ${locationButtonsHtml(photo, index)}`;
}

function groupInfoHtml(photo: Photo): string {
  return `${dateLineHtml(photo)}<br>${formatLocation(photo)}`;
}

function buildSinglePopupHtml(photo: Photo, index: number): string {
  const videoOverlay = isVideo(photo)
    ? '<div class="video-indicator"></div>'
    : '';
  const photosOverlay = buildPhotosOverlay('single-photos-link', photo);

  return `
        <div class="photo-popup">
            <div class="popup-image-wrap">
                <img id="single-img" src="${getThumbUrl(photo)}" alt="Photo" onclick="window.showLightbox(${index})"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22150%22/><text x=%22100%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%23999%22>Preview unavailable</text></svg>'" />
                ${videoOverlay}
                ${photosOverlay}
            </div>
            <div class="info" id="single-info">${singleInfoHtml(photo, index)}</div>
        </div>`;
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

  currentPopup = new maplibregl.Popup({
    closeButton: false,
    maxWidth: '320px',
    anchor: 'bottom',
    offset: [0, -12]
  })
    .setLngLat(coords)
    .setHTML(buildSinglePopupHtml(photo, index))
    .addTo(map);

  updatePasteLink(index);

  currentPopup.on('close', () => {
    dateEditMode = false;
    highlightMarkerFn(null);
    currentSinglePhotoIndex = null;
    currentPhotoUuid = null;
  });

  panToFitPopupFn(coords);
}

export interface MapFeature {
  properties: Record<string, unknown>;
}

function buildDateRangeString(
  firstPhoto: Photo,
  lastPhoto: Photo | undefined
): string {
  if (
    lastPhoto !== undefined &&
    firstPhoto.date !== '' &&
    lastPhoto.date !== ''
  ) {
    const firstDate = formatDate(firstPhoto.date, firstPhoto.tz);
    const lastDate = formatDate(lastPhoto.date, lastPhoto.tz);
    return firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`;
  }
  if (firstPhoto.date !== '') {
    return formatDate(firstPhoto.date, firstPhoto.tz);
  }
  return '';
}

function buildThumbsHtml(photos: Photo[]): string {
  return photos
    .map(
      (photo, i) => `
        <div class="thumb-wrap" onclick="window.selectGroupPhoto(${i})">
            <img class="thumb ${i === 0 ? 'active' : ''}"
                    src="${getThumbUrl(photo)}"
                    onerror="this.style.display='none'" />
            ${isVideo(photo) ? '<div class="thumb-video-badge"></div>' : ''}
        </div>
    `
    )
    .join('');
}

interface PopupContentOptions {
  photos: Photo[];
  firstPhoto: Photo;
  dateRangeStr: string;
  thumbsHtml: string;
}

function buildCountLabel(photos: Photo[]): string {
  const photoCount = photos.filter((p) => !isVideo(p)).length;
  const videoCount = photos.filter((p) => isVideo(p)).length;
  if (photoCount > 0 && videoCount > 0) {
    return `${photoCount} photos \u2022 ${videoCount} videos`;
  }
  if (videoCount > 0) {
    return `${videoCount} videos`;
  }
  return `${photoCount} photos`;
}

function buildPopupContent(options: PopupContentOptions): string {
  const { photos, firstPhoto, dateRangeStr, thumbsHtml } = options;
  const countLabel = buildCountLabel(photos);
  const videoOverlay = isVideo(firstPhoto)
    ? '<div class="video-indicator"></div>'
    : '';
  const photosOverlay = buildPhotosOverlay('group-photos-link', firstPhoto);
  return `
        <div class="photo-popup">
            <div class="photo-count">${countLabel}${dateRangeStr === '' ? '' : ` \u2022 ${dateRangeStr}`}</div>
            <div class="popup-image-wrap">
            <img class="main-image" id="group-main-img" src="${getThumbUrl(firstPhoto)}"
                    onclick="window.showGroupLightbox(0)"
                    onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22150%22/><text x=%22100%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%23999%22>Preview unavailable</text></svg>'" />
            ${videoOverlay}
            ${photosOverlay}
            </div>
            <div class="info" id="group-info">${groupInfoHtml(firstPhoto)}</div>
            <div class="thumb-strip">${thumbsHtml}</div>
        </div>`;
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

  // Sync with UI
  updateLightboxGroup(clusterPhotos);

  clusterPhotos.sort(compareDates);
  currentGroupIndex = 0;
  highlightMarkerFn(clusterPhotos[0]!._index ?? 0);

  const firstPhoto = clusterPhotos[0]!;
  const lastPhoto = clusterPhotos[clusterPhotos.length - 1];
  const dateRangeStr = buildDateRangeString(firstPhoto, lastPhoto);
  const thumbsHtml = buildThumbsHtml(clusterPhotos);

  const popupContent = buildPopupContent({
    photos: clusterPhotos,
    firstPhoto,
    dateRangeStr,
    thumbsHtml
  });

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

function updateVideoIndicator(photo: Photo) {
  const imageWrap = document.querySelector('.photo-popup .popup-image-wrap');
  if (imageWrap === null) return;
  const existing = imageWrap.querySelector('.video-indicator');
  if (isVideo(photo) && existing === null) {
    const indicator = document.createElement('div');
    indicator.className = 'video-indicator';
    imageWrap.appendChild(indicator);
  } else if (!isVideo(photo) && existing !== null) {
    existing.remove();
  }
}

function updatePhotosLink(linkId: string, photo: Photo) {
  const link = document.getElementById(linkId) as HTMLAnchorElement | null;
  if (link === null) return;
  if (photo.photos_url !== undefined && photo.photos_url !== '') {
    link.href = photo.photos_url;
    link.style.display = '';
  } else {
    link.style.display = 'none';
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
    info.innerHTML = groupInfoHtml(photo);
  }
  updatePhotosLink('group-photos-link', photo);
  updateVideoIndicator(photo);

  document.querySelectorAll('.photo-popup .thumb').forEach((thumb, i) => {
    thumb.classList.toggle('active', i === index);
  });

  highlightMarkerFn(photo._index ?? null);
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

export function adjustTime(uuid: string, hours: number) {
  addPendingTimeEdit(uuid, hours);
  // Update displayed time in whichever popup is open
  const singleInfo = document.getElementById('single-info');
  if (singleInfo !== null && currentSinglePhotoIndex !== null) {
    const photo = state.filteredPhotos[currentSinglePhotoIndex];
    if (photo?.uuid === uuid) {
      singleInfo.innerHTML = singleInfoHtml(photo, currentSinglePhotoIndex);
      updatePasteLink(currentSinglePhotoIndex);
    }
  }
  const groupInfo = document.getElementById('group-info');
  if (groupInfo !== null && clusterPhotos.length > 0) {
    const photo = clusterPhotos[currentGroupIndex];
    if (photo?.uuid === uuid) {
      groupInfo.innerHTML = groupInfoHtml(photo);
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

function refreshDateRow() {
  if (currentSinglePhotoIndex !== null) {
    const photo = state.filteredPhotos[currentSinglePhotoIndex];
    if (photo === undefined) return;
    const singleInfo = document.getElementById('single-info');
    if (singleInfo !== null) {
      singleInfo.innerHTML = singleInfoHtml(photo, currentSinglePhotoIndex);
      updatePasteLink(currentSinglePhotoIndex);
    }
  } else if (clusterPhotos.length > 0) {
    const photo = clusterPhotos[currentGroupIndex];
    if (photo === undefined) return;
    const groupInfo = document.getElementById('group-info');
    if (groupInfo !== null) {
      groupInfo.innerHTML = groupInfoHtml(photo);
    }
  }
}

export function copyDateFromPopup() {
  const photo = getCurrentPhoto();
  if (photo === undefined) return;
  const effectiveDate = getEffectiveDate(photo);
  if (effectiveDate === '') return;
  const dayPart = effectiveDate.split(' ')[0];
  if (dayPart === undefined) return;
  copyDate(dayPart);
  refreshDateRow();
}

export function pasteDateToPhoto() {
  const photo = getCurrentPhoto();
  if (photo === undefined) return;
  const copied = getCopiedDate();
  if (copied === null) return;
  const offset = computeDateOffsetHours(photo.date, copied);
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

function computeManualDateOffset(
  originalDate: string,
  parsed: { day: string; time: string | null }
): number | null {
  if (parsed.time === null) {
    return computeDateOffsetHours(originalDate, parsed.day);
  }
  const timeParts = parsed.time.split(':').map(Number);
  const dayParts = parsed.day.split(':');
  const target = new Date(
    parseInt(dayParts[0]!, 10),
    parseInt(dayParts[1]!, 10) - 1,
    parseInt(dayParts[2]!, 10),
    timeParts[0] ?? 0,
    timeParts[1] ?? 0,
    0
  );
  return computeFullDatetimeOffsetHours(originalDate, target);
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

  const img = document.getElementById('single-img') as HTMLImageElement | null;
  const info = document.getElementById('single-info');

  if (img !== null) {
    img.src = getThumbUrl(photo);
    img.onclick = () => {
      window.showLightbox(newIndex);
    };
  }
  if (info !== null) {
    info.innerHTML = singleInfoHtml(photo, newIndex);
  }
  updatePhotosLink('single-photos-link', photo);
  updateVideoIndicator(photo);

  updatePasteLink(newIndex);

  const loc = getEffectiveLocation(photo);
  const lng = loc?.lon ?? 0;
  const lat = loc?.lat ?? 0;
  currentPopup.setLngLat([lng, lat]);
  panToFitPopupFn([lng, lat]);
}
