import maplibregl from 'maplibre-gl';

import {
  addPendingEdit,
  addPendingTimeEdit,
  applyHourOffset,
  getCopiedLocation,
  state
} from './data';
import type { Photo } from './types';
import { updateLightboxGroup } from './ui';
import {
  compareDates,
  durationSpan,
  formatDate,
  formatLocation,
  getThumbUrl,
  isVideo
} from './utils';

// State
let currentPopup: maplibregl.Popup | null = null;
let clusterPhotos: Photo[] = [];
let currentSinglePhotoIndex: number | null = null;
let currentPhotoUuid: string | null = null;
let currentGroupIndex = 0;

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

function timeButtonsHtml(uuid: string): string {
  return `<span class="time-adjust-buttons"><button class="time-btn" onclick="event.preventDefault(); window.adjustTime('${uuid}', -1)">-1h</button><button class="time-btn" onclick="event.preventDefault(); window.adjustTime('${uuid}', 1)">+1h</button></span>`;
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

function buildPasteLocationHtml(photo: Photo): string {
  const visible = shouldShowPasteLink(photo);
  return `<a class="photos-link" id="single-paste-location" href="#"${visible ? '' : ' style="display:none"'}>Paste location</a>`;
}

function buildPhotosOverlay(id: string, photo: Photo): string {
  if (photo.photos_url !== undefined && photo.photos_url !== '') {
    return `<a class="photos-overlay-btn" id="${id}" href="${photo.photos_url}" target="_blank" tabindex="-1" onclick="event.stopPropagation()"></a>`;
  }
  return `<a class="photos-overlay-btn" id="${id}" href="#" target="_blank" tabindex="-1" onclick="event.stopPropagation()" style="display:none"></a>`;
}

function buildSinglePopupHtml(photo: Photo, index: number): string {
  const videoOverlay = isVideo(photo)
    ? '<div class="video-indicator"></div>'
    : '';
  const photosOverlay = buildPhotosOverlay('single-photos-link', photo);

  const setLocationHtml = `<a class="photos-link" id="single-set-location" href="#" onclick="event.preventDefault(); window.enterPlacementMode(${index})">Set location</a>`;
  const loc = getEffectiveLocation(photo);
  const copyLocationHtml =
    loc === null
      ? ''
      : `<a class="photos-link" id="single-copy-location" href="#" onclick="event.preventDefault(); window.copyLocation(${loc.lat}, ${loc.lon})">Copy location</a>`;
  const pasteLocationHtml = buildPasteLocationHtml(photo);

  return `
        <div class="photo-popup">
            <div class="popup-image-wrap">
                <img id="single-img" src="${getThumbUrl(photo)}" alt="Photo" onclick="window.showLightbox(${index})"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22150%22/><text x=%22100%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%23999%22>Preview unavailable</text></svg>'" />
                ${videoOverlay}
                ${photosOverlay}
            </div>
            <div class="info" id="single-info">${formatDate(getEffectiveDate(photo))}${durationSpan(photo)} ${timeButtonsHtml(photo.uuid)}<br>${formatLocation(photo)}</div>
            ${setLocationHtml}
            ${copyLocationHtml}
            ${pasteLocationHtml}
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
    const firstDate = formatDate(firstPhoto.date);
    const lastDate = formatDate(lastPhoto.date);
    return firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`;
  }
  if (firstPhoto.date !== '') {
    return formatDate(firstPhoto.date);
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
            <div class="info" id="group-info">${formatDate(getEffectiveDate(firstPhoto))} ${timeButtonsHtml(firstPhoto.uuid)}<br>${formatLocation(firstPhoto)}</div>
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
    info.innerHTML = `${formatDate(getEffectiveDate(photo))} ${timeButtonsHtml(photo.uuid)}<br>${formatLocation(photo)}`;
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

function updatePopupActions(index: number, photo: Photo) {
  const setLocLink = document.getElementById('single-set-location');
  if (setLocLink !== null) {
    setLocLink.onclick = (ev) => {
      ev.preventDefault();
      window.enterPlacementMode(index);
    };
  }

  const copyLocLink = document.getElementById('single-copy-location');
  if (copyLocLink !== null) {
    const loc = getEffectiveLocation(photo);
    if (loc === null) {
      copyLocLink.style.display = 'none';
    } else {
      copyLocLink.onclick = (ev) => {
        ev.preventDefault();
        window.copyLocation(loc.lat, loc.lon);
      };
      copyLocLink.style.display = '';
    }
  }

  updatePasteLink(index);
}

export function adjustTime(uuid: string, hours: number) {
  addPendingTimeEdit(uuid, hours);
  // Update displayed time in whichever popup is open
  const singleInfo = document.getElementById('single-info');
  if (singleInfo !== null && currentSinglePhotoIndex !== null) {
    const photo = state.filteredPhotos[currentSinglePhotoIndex];
    if (photo?.uuid === uuid) {
      singleInfo.innerHTML = `${formatDate(getEffectiveDate(photo))}${durationSpan(photo)} ${timeButtonsHtml(photo.uuid)}<br>${formatLocation(photo)}`;
    }
  }
  const groupInfo = document.getElementById('group-info');
  if (groupInfo !== null && clusterPhotos.length > 0) {
    const photo = clusterPhotos[currentGroupIndex];
    if (photo?.uuid === uuid) {
      groupInfo.innerHTML = `${formatDate(getEffectiveDate(photo))} ${timeButtonsHtml(photo.uuid)}<br>${formatLocation(photo)}`;
    }
  }
}

export function pasteLocation(photoIndex: number) {
  const photo = state.filteredPhotos[photoIndex];
  const copied = getCopiedLocation();
  if (photo === undefined || copied === null) return;

  addPendingEdit(photo.uuid, copied.lat, copied.lon);
  showPopup({ index: photoIndex }, [copied.lon, copied.lat]);
}

export function navigateSinglePhoto(newIndex: number) {
  const photo = state.filteredPhotos[newIndex];
  if (photo === undefined || currentPopup === null) return;

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
    info.innerHTML = `${formatDate(getEffectiveDate(photo))}${durationSpan(photo)} ${timeButtonsHtml(photo.uuid)}<br>${formatLocation(photo)}`;
  }
  updatePhotosLink('single-photos-link', photo);
  updateVideoIndicator(photo);

  updatePopupActions(newIndex, photo);

  const lng = photo.lon ?? 0;
  const lat = photo.lat ?? 0;
  currentPopup.setLngLat([lng, lat]);
  panToFitPopupFn([lng, lat]);
}
