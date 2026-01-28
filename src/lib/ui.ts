import { state } from './data';
import type { Photo } from './types';
import { formatDate, getFullUrl, isVideo } from './utils';

// --- Lightbox Elements ---
let lightbox: HTMLElement | null = null;
let lightboxImg: HTMLImageElement | null = null;
let lightboxInfo: HTMLElement | null = null;
let lightboxPhotosLink: HTMLAnchorElement | null = null;
let lightboxPlay: HTMLElement | null = null;

// --- State Tracking for Lightbox ---
let currentPhotoIndex = 0;
let currentGroupIndex = 0;
let currentGroupPhotos: Photo[] = [];
let lightboxMode: 'all' | 'group' | '' = '';

export function initUI() {
  const lb = document.getElementById('lightbox');
  if (lb === null) {
    throw new Error('Lightbox element not found');
  }
  lightbox = lb;

  lightboxImg = document.getElementById('lightbox-img') as HTMLImageElement;
  lightboxInfo = document.getElementById('lightbox-info');
  lightboxPhotosLink = document.getElementById(
    'lightbox-photos-link'
  ) as HTMLAnchorElement;
  lightboxPlay = document.getElementById('lightbox-play');

  setupLightboxEvents();
}

function addButtonListener(
  selector: string,
  handler: (e: Event) => void
): void {
  const btn = lightbox?.querySelector(selector);
  if (btn !== null && btn !== undefined) {
    btn.addEventListener('click', handler);
  }
}

function handleLightboxKeydown(e: KeyboardEvent): void {
  if (lightbox?.classList.contains('active') !== true) {
    return;
  }
  if (e.key === 'Escape') hideLightbox();
  if (e.key === 'ArrowRight') nextPhoto();
  if (e.key === 'ArrowLeft') prevPhoto();
}

function setupLightboxEvents() {
  addButtonListener('.close', hideLightbox);
  addButtonListener('.next', (e) => {
    e.stopPropagation();
    nextPhoto();
  });
  addButtonListener('.prev', (e) => {
    e.stopPropagation();
    prevPhoto();
  });

  lightbox?.addEventListener('click', hideLightbox);
  lightboxImg?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.addEventListener('keydown', handleLightboxKeydown);
}

function updateLightboxPhotosLink(photo: Photo) {
  if (lightboxPhotosLink === null) return;
  if (photo.photos_url !== undefined && photo.photos_url !== '') {
    lightboxPhotosLink.href = photo.photos_url;
    lightboxPhotosLink.textContent = isVideo(photo)
      ? 'Play in Photos'
      : 'Open in Photos';
    lightboxPhotosLink.style.display = 'block';
  } else {
    lightboxPhotosLink.style.display = 'none';
  }
}

export function showLightbox(index: number) {
  currentPhotoIndex = index;
  lightboxMode = 'all';
  const photo = state.filteredPhotos[index];
  if (photo === undefined) return;

  displayPhoto(photo, index + 1, state.filteredPhotos.length);
  if (lightbox !== null) lightbox.classList.add('active');
}

export function showGroupLightbox(index: number, groupPhotos?: Photo[]) {
  // If groupPhotos is passed, update state. If not, rely on existing (helper for window calls usually passes nothing if just switching index?)
  // Actually, onclick="window.showGroupLightbox(i)" only passes index.
  // So map.ts must rely on currentGroupPhotos being set?
  // No, map.ts calls showGroupLightbox with index only?
  // Wait, in map.ts: window.showGroupLightbox(index)
  // But where is currentGroupPhotos set?
  // Ah, map.ts has its own `clusterPhotos` array.
  // ui.ts has `currentGroupPhotos`.
  // If map.ts handles the cluster, then ui.ts needs access to it?
  // OR map.ts should pass the array.
  // But the onclick string is static/hardcoded or simple.

  // Resolution: map.ts's `clusterPhotos` describes the group.
  // ui.ts needs to know about this group.
  // Maybe `selectGroupPhoto` in map.ts (which is called before lightbox) sets the "active group"?
  // Yes, map.ts has `clusterPhotos`.
  // ui.ts needs to sync with that.

  // Actually, let's export `setLightboxGroup(photos)` ?
  // Or simpler: map.ts calls `showGroupLightbox` logic directly?
  // No, lightbox logic is in ui.ts.

  // Hack: map.ts exposes `getClusterPhotos()` ?
  // DO NOT overcomplicate.
  // In `index.ts`, `window.showGroupLightbox` calls `ui.showGroupLightbox`.
  // `map.ts` has the data.
  // I should pass the data FROM map.ts TO ui.ts when the popup opens?
  // `selectGroupPhoto` in `map.ts` is called when clicking a thumb.

  // Changing design slightly:
  // `map.ts` exports `getClusterPhotos()`.
  // `ui.ts` imports `getClusterPhotos` from `map.ts`? Circular dependency!

  // Okay, `ui.ts` should hold the lightbox state.
  // `map.ts` calls `setLightboxGroup(photos)` whenever a popup opens with multiple photos.
  // Let's add `updateLightboxGroup(photos)` export to `ui.ts`.
  // `map.ts` calls it in `showMultiPhotoPopup`.

  // For this fix:
  // I will assume `groupPhotos` is managed via `updateLightboxGroup`.

  currentGroupIndex = index;
  lightboxMode = 'group';

  const photo = currentGroupPhotos[index];
  if (photo === undefined) return;

  displayPhoto(photo, index + 1, currentGroupPhotos.length);
  if (lightbox !== null) lightbox.classList.add('active');
}

export function updateLightboxGroup(photos: Photo[]) {
  currentGroupPhotos = photos;
}

function displayPhoto(photo: Photo, index: number, total: number) {
  if (lightboxImg !== null) {
    lightboxImg.src = getFullUrl(photo);
  }
  const isVid = isVideo(photo);
  const durationHtml =
    isVid && photo.duration !== undefined
      ? ` <span class="duration">${photo.duration}</span>`
      : '';
  const countInfo = `<br>(${index} of ${total})`;
  if (lightboxInfo !== null) {
    lightboxInfo.innerHTML = `${formatDate(photo.date)}${durationHtml}<br>${photo.lat.toFixed(4)}°N, ${photo.lon.toFixed(4)}°E${countInfo}`;
  }
  if (lightbox !== null) {
    lightbox.classList.toggle('video', isVid);
  }
  if (lightboxPlay !== null && isVid) {
    lightboxPlay.onclick = () => {
      if (photo.photos_url !== undefined && photo.photos_url !== '') {
        window.open(photo.photos_url, '_blank');
      }
    };
  }
  updateLightboxPhotosLink(photo);
}

function hideLightbox() {
  if (lightbox !== null) {
    lightbox.classList.remove('active');
    lightbox.classList.remove('video');
  }
  lightboxMode = '';
}

function nextPhoto() {
  if (lightboxMode === 'group') {
    currentGroupIndex = (currentGroupIndex + 1) % currentGroupPhotos.length;
    const photo = currentGroupPhotos[currentGroupIndex];
    if (photo !== undefined) {
      displayPhoto(photo, currentGroupIndex + 1, currentGroupPhotos.length);
    }
  } else {
    currentPhotoIndex = (currentPhotoIndex + 1) % state.filteredPhotos.length;
    const photo = state.filteredPhotos[currentPhotoIndex];
    if (photo !== undefined) {
      displayPhoto(photo, currentPhotoIndex + 1, state.filteredPhotos.length);
    }
  }
}

function prevPhoto() {
  if (lightboxMode === 'group') {
    currentGroupIndex =
      (currentGroupIndex - 1 + currentGroupPhotos.length) %
      currentGroupPhotos.length;
    const photo = currentGroupPhotos[currentGroupIndex];
    if (photo !== undefined) {
      displayPhoto(photo, currentGroupIndex + 1, currentGroupPhotos.length);
    }
  } else {
    currentPhotoIndex =
      (currentPhotoIndex - 1 + state.filteredPhotos.length) %
      state.filteredPhotos.length;
    const photo = state.filteredPhotos[currentPhotoIndex];
    if (photo !== undefined) {
      displayPhoto(photo, currentPhotoIndex + 1, state.filteredPhotos.length);
    }
  }
}

export function updateStats(filteredPhotos: Photo[]) {
  const countEl = document.getElementById('photo-count');
  const dateRangeEl = document.getElementById('date-range');
  if (countEl === null || dateRangeEl === null) return;

  countEl.textContent = filteredPhotos.length.toString();

  const photosWithDates = filteredPhotos.filter((p) => p.date !== '');
  if (photosWithDates.length > 0) {
    const firstDate = formatDate(photosWithDates[0]!.date);
    const lastDate = formatDate(
      photosWithDates[photosWithDates.length - 1]!.date
    );
    dateRangeEl.textContent = `${firstDate} – ${lastDate}`;
  } else {
    dateRangeEl.textContent = '';
  }
}

export function populateYearFilter(years: string[]) {
  const select = document.getElementById(
    'year-select'
  ) as HTMLSelectElement | null;
  if (select === null) return;
  // Clear existing options except first
  while (select.options.length > 1) {
    select.remove(1);
  }

  years.forEach((year) => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    select.appendChild(option);
  });
}

export function browseAllPhotos() {
  if (state.filteredPhotos.length === 0) return;
  showLightbox(0);
}
