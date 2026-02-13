import {
  applyHourOffset,
  getCopiedDate,
  getCopiedLocation,
  state
} from './data';
import type { Photo } from './types';
import {
  computeDateOffsetHours,
  computeFullDatetimeOffsetHours,
  durationSpan,
  formatDate,
  formatLocation,
  getThumbUrl,
  isVideo
} from './utils';

export function getEffectiveDate(photo: Photo): string {
  const offset = state.pendingTimeEdits.get(photo.uuid) ?? 0;
  if (offset === 0) return photo.date;
  return applyHourOffset(photo.date, offset);
}

export function getEffectiveLocation(
  photo: Photo
): { lat: number; lon: number } | null {
  const pending = state.pendingEdits.get(photo.uuid);
  if (pending !== undefined) return pending;
  if (photo.lat !== null && photo.lon !== null) {
    return { lat: photo.lat, lon: photo.lon };
  }
  return null;
}

function shouldShowDatePaste(photo: Photo): boolean {
  const copied = getCopiedDate();
  if (copied === null) return false;
  const effectiveDate = getEffectiveDate(photo);
  if (effectiveDate === '') return false;
  return effectiveDate !== copied;
}

function shouldShowPasteLink(photo: Photo): boolean {
  const copied = getCopiedLocation();
  if (copied === null) return false;
  const loc = getEffectiveLocation(photo);
  if (loc === null) return true;
  return copied.lat !== loc.lat || copied.lon !== loc.lon;
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

function dateNormalButtonsHtml(showPaste: boolean): string {
  return `<span class="time-adjust-buttons"><button class="time-btn" onclick="event.preventDefault(); window.copyDateFromPopup()">copy</button><button class="time-btn" id="date-paste" onclick="event.preventDefault(); window.pasteDateToPhoto()"${showPaste ? '' : ' style="display:none"'}>paste</button><button class="time-btn" onclick="event.preventDefault(); window.toggleDateEdit()">edit</button></span>`;
}

function dateEditButtonsHtml(uuid: string): string {
  return `<span class="time-adjust-buttons"><button class="time-btn" onclick="event.preventDefault(); window.adjustTime('${uuid}', -24)">-1d</button><button class="time-btn" onclick="event.preventDefault(); window.adjustTime('${uuid}', 24)">+1d</button><button class="time-btn" onclick="event.preventDefault(); window.adjustTime('${uuid}', -1)">-1h</button><button class="time-btn" onclick="event.preventDefault(); window.adjustTime('${uuid}', 1)">+1h</button><button class="time-btn" onclick="event.preventDefault(); window.toggleDateEdit()">done</button></span>`;
}

export function dateLineHtml(
  photo: Photo,
  isEditMode: boolean
): string {
  const effectiveDate = getEffectiveDate(photo);
  const dateText = formatDate(effectiveDate, photo.tz);
  const duration = durationSpan(photo);
  if (isEditMode) {
    const inputVal = editableDateStr(effectiveDate);
    return `${dateText}${duration} ${dateEditButtonsHtml(photo.uuid)}<div class="date-edit-row"><input class="date-input" type="text" value="${inputVal}" id="date-input" onkeydown="window.handleDateInputKey(event)" /><button class="time-btn" onclick="event.preventDefault(); window.applyManualDate()">OK</button></div>`;
  }
  return `${dateText}${duration} ${dateNormalButtonsHtml(shouldShowDatePaste(photo))}`;
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

export function buildOverlayButtons(
  photosLinkId: string,
  photo: Photo
): string {
  const photosBtn =
    photo.photos_url !== undefined && photo.photos_url !== ''
      ? `<a class="overlay-btn photos-btn" id="${photosLinkId}" href="${photo.photos_url}" target="_blank" tabindex="-1" onclick="event.stopPropagation()"></a>`
      : `<a class="overlay-btn photos-btn" id="${photosLinkId}" href="#" target="_blank" tabindex="-1" onclick="event.stopPropagation()" style="display:none"></a>`;
  const infoBtn = `<button class="overlay-btn info-btn" onclick="event.stopPropagation(); window.showMetadata('${photo.uuid}')" tabindex="-1"></button>`;
  return `<div class="overlay-buttons">${infoBtn}${photosBtn}</div>`;
}

export function singleInfoHtml(
  photo: Photo,
  index: number,
  isEditMode: boolean
): string {
  return `${dateLineHtml(photo, isEditMode)}<br>${formatLocation(photo)} ${locationButtonsHtml(photo, index)}`;
}

export function groupInfoHtml(
  photo: Photo,
  isEditMode: boolean
): string {
  return `${dateLineHtml(photo, isEditMode)}<br>${formatLocation(photo)}`;
}

export function buildSinglePopupHtml(
  photo: Photo,
  index: number,
  isEditMode: boolean
): string {
  const videoOverlay = isVideo(photo)
    ? '<div class="video-indicator"></div>'
    : '';
  const overlayButtons = buildOverlayButtons('single-photos-link', photo);
  return `
        <div class="photo-popup">
            <div class="popup-image-wrap">
                <img id="single-img" src="${getThumbUrl(photo)}" alt="Photo" onclick="window.showLightbox(${index})"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22150%22/><text x=%22100%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%23999%22>Preview unavailable</text></svg>'" />
                ${videoOverlay}
                ${overlayButtons}
            </div>
            <div class="info" id="single-info">${singleInfoHtml(photo, index, isEditMode)}</div>
        </div>`;
}

export function buildDateRangeString(
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

export function buildThumbsHtml(photos: Photo[]): string {
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

export function buildPopupContent(
  photos: Photo[],
  firstPhoto: Photo,
  dateRangeStr: string,
  thumbsHtml: string
): string {
  const countLabel = buildCountLabel(photos);
  const videoOverlay = isVideo(firstPhoto)
    ? '<div class="video-indicator"></div>'
    : '';
  const overlayButtons = buildOverlayButtons('group-photos-link', firstPhoto);
  return `
        <div class="photo-popup">
            <div class="photo-count">${countLabel}${dateRangeStr === '' ? '' : ` \u2022 ${dateRangeStr}`}</div>
            <div class="popup-image-wrap">
            <img class="main-image" id="group-main-img" src="${getThumbUrl(firstPhoto)}"
                    onclick="window.showGroupLightbox(0)"
                    onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22150%22/><text x=%22100%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%23999%22>Preview unavailable</text></svg>'" />
            ${videoOverlay}
            ${overlayButtons}
            </div>
            <div class="info" id="group-info">${groupInfoHtml(firstPhoto, false)}</div>
            <div class="thumb-strip">${thumbsHtml}</div>
        </div>`;
}

export function updateVideoIndicator(photo: Photo) {
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

export function updateInfoOverlay(photo: Photo) {
  const btn = document.querySelector<HTMLButtonElement>(
    '.popup-image-wrap .info-btn'
  );
  if (btn === null) return;
  btn.onclick = (e) => {
    e.stopPropagation();
    window.showMetadata(photo.uuid);
  };
}

export function updatePhotosLink(linkId: string, photo: Photo) {
  const link = document.getElementById(linkId) as HTMLAnchorElement | null;
  if (link === null) return;
  if (photo.photos_url !== undefined && photo.photos_url !== '') {
    link.href = photo.photos_url;
    link.style.display = '';
  } else {
    link.style.display = 'none';
  }
}

export function computeManualDateOffset(
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
