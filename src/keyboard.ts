import { state } from '@common/data';
import type { PhotoLightbox } from '@components/photo-lightbox';
import {
  getCurrentPopup,
  getCurrentSinglePhotoIndex,
  isDateEditMode,
  navigateSinglePhoto,
  toggleDateEdit
} from './map/popup';

function getLightbox(): PhotoLightbox {
  return document.getElementById('lightbox') as unknown as PhotoLightbox;
}

function handleArrowNav(e: KeyboardEvent) {
  if (getLightbox().isActive) return false;
  if (getCurrentSinglePhotoIndex() === null) return false;
  e.preventDefault();
  const total = state.filteredPhotos.length;
  const idx = getCurrentSinglePhotoIndex()!;
  const newIdx = (idx + (e.key === 'ArrowLeft' ? -1 : 1) + total) % total;
  navigateSinglePhoto(newIdx);
  return true;
}

function handleSpaceKey(e: KeyboardEvent) {
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  if (getLightbox().isActive) {
    e.preventDefault();
    e.stopPropagation();
    getLightbox().hide();
    return;
  }
  const idx = getCurrentSinglePhotoIndex();
  if (idx !== null) {
    e.preventDefault();
    e.stopPropagation();
    getLightbox().show(idx);
  }
}

export function initKeyboard() {
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        if (isDateEditMode()) {
          e.preventDefault();
          toggleDateEdit();
        } else if (getCurrentPopup() !== null) {
          e.preventDefault();
          getCurrentPopup()?.remove();
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        handleArrowNav(e);
        return;
      }
      if (e.key === ' ') {
        handleSpaceKey(e);
      }
    },
    true
  );

  getLightbox().setNavigateCallback((index) => {
    navigateSinglePhoto(index);
  });
}
