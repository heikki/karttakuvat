import { state } from './data';
import { getEffectiveDate, getEffectiveLocation } from './popup-html';
import type { Photo } from './types';
import { formatCoords, formatDate, getFullUrl, isVideo } from './utils';

// --- Lightbox Elements ---
let lightbox: HTMLElement | null = null;
let lightboxImg: HTMLImageElement | null = null;
let lightboxInfo: HTMLElement | null = null;
let lightboxPhotosLink: HTMLAnchorElement | null = null;
let lightboxCamera: HTMLElement | null = null;
let lightboxInfoBtn: HTMLButtonElement | null = null;

// --- State Tracking for Lightbox ---
let currentPhotoIndex = 0;
let currentGroupIndex = 0;
let currentGroupPhotos: Photo[] = [];
let lightboxMode: 'all' | 'group' | '' = '';

// Callback for syncing lightbox navigation to map markers
let onNavigateFn: ((mode: 'all' | 'group', index: number) => void) | null =
  null;

export function setLightboxNavigateCallback(
  fn: (mode: 'all' | 'group', index: number) => void
) {
  onNavigateFn = fn;
}

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
  lightboxCamera = document.getElementById('lightbox-camera');
  lightboxInfoBtn = document.getElementById(
    'lightbox-info-btn'
  ) as HTMLButtonElement | null;

  setupLightboxEvents();
}

export function isLightboxActive(): boolean {
  return lightbox?.classList.contains('active') === true;
}

function handleLightboxKeydown(e: KeyboardEvent): void {
  if (!isLightboxActive()) {
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    hideLightbox();
    e.stopImmediatePropagation();
    return;
  }
  if (e.key === 'ArrowRight') nextPhoto();
  if (e.key === 'ArrowLeft') prevPhoto();
}

function setupLightboxEvents() {
  lightbox?.addEventListener('click', hideLightbox);

  const imageWrap = document.getElementById('lightbox-image-wrap');
  imageWrap?.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.addEventListener('keydown', handleLightboxKeydown);
}

function updateLightboxPhotosLink(photo: Photo) {
  if (lightboxPhotosLink === null) return;
  if (photo.photos_url !== undefined && photo.photos_url !== '') {
    lightboxPhotosLink.href = photo.photos_url;
    lightboxPhotosLink.style.display = '';
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
  if (lightboxInfo !== null) {
    lightboxInfo.innerHTML = `${formatDate(getEffectiveDate(photo), photo.tz)}<br>${formatCoords(getEffectiveLocation(photo))}`;
  }
  if (lightbox !== null) {
    lightbox.classList.toggle('video', isVid);
  }
  updateLightboxPhotosLink(photo);
  if (lightboxInfoBtn !== null) {
    lightboxInfoBtn.onclick = (e) => {
      e.stopPropagation();
      window.showMetadata(photo.uuid);
    };
  }
  if (lightboxCamera !== null) {
    if (photo.camera === null) {
      lightboxCamera.classList.remove('visible');
    } else {
      lightboxCamera.textContent = photo.camera;
      lightboxCamera.classList.add('visible');
    }
  }
}

export function hideLightbox() {
  if (lightbox !== null) {
    lightbox.classList.remove('active');
    lightbox.classList.remove('video');
  }
  lightboxMode = '';
}

function navigateAndSync(newIndex: number) {
  if (lightboxMode === 'group') {
    currentGroupIndex = newIndex;
    const photo = currentGroupPhotos[currentGroupIndex];
    if (photo !== undefined) {
      displayPhoto(photo, currentGroupIndex + 1, currentGroupPhotos.length);
      onNavigateFn?.('group', currentGroupIndex);
    }
  } else {
    currentPhotoIndex = newIndex;
    const photo = state.filteredPhotos[currentPhotoIndex];
    if (photo !== undefined) {
      displayPhoto(photo, currentPhotoIndex + 1, state.filteredPhotos.length);
      onNavigateFn?.('all', currentPhotoIndex);
    }
  }
}

function nextPhoto() {
  if (lightboxMode === 'group') {
    navigateAndSync((currentGroupIndex + 1) % currentGroupPhotos.length);
  } else {
    navigateAndSync((currentPhotoIndex + 1) % state.filteredPhotos.length);
  }
}

function prevPhoto() {
  if (lightboxMode === 'group') {
    navigateAndSync(
      (currentGroupIndex - 1 + currentGroupPhotos.length) %
        currentGroupPhotos.length
    );
  } else {
    navigateAndSync(
      (currentPhotoIndex - 1 + state.filteredPhotos.length) %
        state.filteredPhotos.length
    );
  }
}

export function updateStats(filteredPhotos: Photo[]) {
  const countLabel = document.getElementById('count-label');
  if (countLabel === null) return;

  if (filteredPhotos.length === 0) {
    countLabel.textContent = 'No results';
  } else {
    const photoCount = filteredPhotos.filter((p) => !isVideo(p)).length;
    const videoCount = filteredPhotos.filter((p) => isVideo(p)).length;
    if (photoCount > 0 && videoCount > 0) {
      countLabel.textContent = `${photoCount} photos, ${videoCount} videos`;
    } else if (videoCount > 0) {
      countLabel.textContent = `${videoCount} videos`;
    } else {
      countLabel.textContent = `${photoCount} photos`;
    }
  }
}

export function repopulateSelect(id: string, options: string[]) {
  const select = document.getElementById(id) as HTMLSelectElement | null;
  if (select === null) return;
  const prev = select.value;
  while (select.options.length > 1) {
    select.remove(1);
  }
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt;
    el.textContent = opt;
    select.appendChild(el);
  }
  select.value = prev;
  if (select.value !== prev) select.value = 'all';
}

export function updatePendingEdits(count: number) {
  const section = document.getElementById('edit-section');
  const countEl = document.getElementById('pending-count');
  if (section === null) return;

  if (count > 0) {
    section.style.display = 'block';
    if (countEl !== null) {
      countEl.textContent = count.toString();
    }
  } else {
    section.style.display = 'none';
  }
}
