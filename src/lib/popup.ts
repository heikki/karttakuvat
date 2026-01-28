import maplibregl from 'maplibre-gl';

import { state } from './data';
import type { Photo } from './types';
import { updateLightboxGroup } from './ui';
import {
  compareDates,
  durationSpan,
  formatDate,
  getThumbUrl,
  isVideo
} from './utils';

// State
let currentPopup: maplibregl.Popup | null = null;
let clusterPhotos: Photo[] = [];
let currentSinglePhotoIndex: number | null = null;
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

export function setCurrentSinglePhotoIndex(index: number | null) {
  currentSinglePhotoIndex = index;
}

export interface FeatureProps {
  index: number;
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
  clusterPhotos = [];
  highlightMarkerFn(index);

  const isVid = isVideo(photo);
  const linkText = isVid ? 'Play in Photos' : 'Open in Photos';
  const photosLinkHtml =
    photo.photos_url !== undefined && photo.photos_url !== ''
      ? `<a class="photos-link" id="single-photos-link" href="${photo.photos_url}">${linkText}</a>`
      : `<a class="photos-link" id="single-photos-link" href="#" style="display:none">${linkText}</a>`;
  const videoOverlay = isVid ? '<div class="video-indicator"></div>' : '';

  const popupContent = `
        <div class="photo-popup">
            <div class="popup-image-wrap">
                <img id="single-img" src="${getThumbUrl(photo)}" alt="Photo" onclick="window.showLightbox(${index})"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22150%22/><text x=%22100%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%23999%22>Preview unavailable</text></svg>'" />
                ${videoOverlay}
            </div>
            <div class="info" id="single-info">${formatDate(photo.date)}${durationSpan(photo)}<br>${photo.lat.toFixed(4)}°N, ${photo.lon.toFixed(4)}°E</div>
            ${photosLinkHtml}
        </div>`;

  currentPopup = new maplibregl.Popup({
    closeButton: false,
    maxWidth: '320px',
    anchor: 'bottom',
    offset: [0, -12]
  })
    .setLngLat(coords)
    .setHTML(popupContent)
    .addTo(map);

  currentPopup.on('close', () => {
    highlightMarkerFn(null);
    currentSinglePhotoIndex = null;
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
  photosLinkHtml: string;
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
  const { photos, firstPhoto, dateRangeStr, thumbsHtml, photosLinkHtml } =
    options;
  const countLabel = buildCountLabel(photos);
  const isVid = isVideo(firstPhoto);
  const videoOverlay = isVid ? '<div class="video-indicator"></div>' : '';
  return `
        <div class="photo-popup">
            <div class="photo-count">${countLabel}${dateRangeStr === '' ? '' : ` \u2022 ${dateRangeStr}`}</div>
            <div class="popup-image-wrap">
            <img class="main-image" id="group-main-img" src="${getThumbUrl(firstPhoto)}"
                    onclick="window.showGroupLightbox(0)" 
                    onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22150%22/><text x=%22100%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%23999%22>Preview unavailable</text></svg>'" />
            ${videoOverlay}
            </div>
            <div class="info" id="group-info">${formatDate(firstPhoto.date)}<br>${firstPhoto.lat.toFixed(4)}°N, ${firstPhoto.lon.toFixed(4)}°E</div>
            ${photosLinkHtml}
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

  const groupLinkText = isVideo(firstPhoto)
    ? 'Play in Photos'
    : 'Open in Photos';
  const photosLinkHtml =
    firstPhoto.photos_url !== undefined && firstPhoto.photos_url !== ''
      ? `<a class="photos-link" id="group-photos-link" href="${firstPhoto.photos_url}">${groupLinkText}</a>`
      : '';

  const popupContent = buildPopupContent({
    photos: clusterPhotos,
    firstPhoto,
    dateRangeStr,
    thumbsHtml,
    photosLinkHtml
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
    link.textContent = isVideo(photo) ? 'Play in Photos' : 'Open in Photos';
    link.style.display = 'inline-block';
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
    info.innerHTML = `${formatDate(photo.date)}<br>${photo.lat.toFixed(4)}°N, ${photo.lon.toFixed(4)}°E`;
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

export function navigateSinglePhoto(newIndex: number) {
  const photo = state.filteredPhotos[newIndex];
  if (photo === undefined || currentPopup === null) return;

  currentSinglePhotoIndex = newIndex;
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
    info.innerHTML = `${formatDate(photo.date)}${durationSpan(photo)}<br>${photo.lat.toFixed(4)}°N, ${photo.lon.toFixed(4)}°E`;
  }
  updatePhotosLink('single-photos-link', photo);
  updateVideoIndicator(photo);

  currentPopup.setLngLat([photo.lon, photo.lat]);
  panToFitPopupFn([photo.lon, photo.lat]);
}
