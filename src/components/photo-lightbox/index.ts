import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { ShowLightboxEvent, ShowMetadataEvent } from '@common/events';
import { state } from '@common/data';
import { getEffectiveDate, getEffectiveLocation } from '@common/photo-utils';
import type { Photo } from '@common/types';
import { formatCoords, formatDate, getFullUrl, isVideo } from '@common/utils';

function stopPropagation(e: Event) {
  e.stopPropagation();
}

@customElement('photo-lightbox')
export class PhotoLightbox extends LitElement {
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ attribute: false }) photo: Photo | null = null;
  @property({ type: Number }) currentIndex = 0;
  @property({ type: Number }) totalCount = 0;

  private _onNavigate: ((index: number) => void) | null = null;

  setNavigateCallback(fn: (index: number) => void) {
    this._onNavigate = fn;
  }

  show(index: number) {
    this.currentIndex = index;
    const photo = state.filteredPhotos[index];
    if (photo === undefined) return;
    this.photo = photo;
    this.totalCount = state.filteredPhotos.length;
    this.active = true;
  }

  hide() {
    this.active = false;
    this.photo = null;
  }

  get isActive(): boolean {
    return this.active;
  }

  private _navigate(delta: number) {
    const total = state.filteredPhotos.length;
    if (total === 0) return;
    const newIndex = (this.currentIndex + delta + total) % total;
    this.currentIndex = newIndex;
    this.photo = state.filteredPhotos[newIndex] ?? null;
    this.totalCount = total;
    this._onNavigate?.(newIndex);
  }

  static override styles = css`
    *, *::before, *::after { box-sizing: border-box; }
    :host {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      z-index: 2000;
      justify-content: center;
      align-items: center;
    }
    :host([active]) {
      display: flex;
    }
    .image-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      max-width: 95%;
      max-height: 95%;
    }
    img {
      max-width: 95vw;
      max-height: 95vh;
      object-fit: contain;
    }
    .info {
      position: absolute;
      bottom: 10px;
      left: 10px;
      color: white;
      font-size: 12px;
      background: rgba(0, 0, 0, 0.5);
      padding: 4px 8px;
      border-radius: 6px;
      pointer-events: none;
      z-index: 5;
    }
    .overlay-buttons {
      position: absolute;
      top: 10px;
      right: 10px;
      display: flex;
      gap: 4px;
      z-index: 5;
    }
    .overlay-btn {
      width: 36px;
      height: 36px;
      background: rgba(0, 0, 0, 0.5);
      border: none;
      outline: none;
      border-radius: 8px;
      cursor: pointer;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 20px;
      display: block;
      text-decoration: none;
    }
    .overlay-btn:hover {
      background-color: rgba(0, 0, 0, 0.75);
    }
    .photos-btn {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'/%3E%3Cpolyline points='15 3 21 3 21 9'/%3E%3Cline x1='10' y1='14' x2='21' y2='3'/%3E%3C/svg%3E");
    }
    .info-btn {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='16' x2='12' y2='12'/%3E%3Cline x1='12' y1='8' x2='12.01' y2='8'/%3E%3C/svg%3E");
    }
    .camera-overlay {
      display: none;
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.5);
      color: white;
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 6px;
      pointer-events: none;
      z-index: 5;
    }
    .camera-overlay.visible {
      display: block;
    }
    .play-overlay {
      display: none;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 80px;
      height: 80px;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 50%;
      pointer-events: none;
      z-index: 10;
    }
    .play-overlay::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 54%;
      transform: translate(-50%, -50%);
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 16px 0 16px 28px;
      border-color: transparent transparent transparent white;
    }
    :host([active]) .play-overlay.video {
      display: block;
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._handleKeydown);
    document.addEventListener(ShowLightboxEvent.type, this._handleShowLightbox);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._handleKeydown);
    document.removeEventListener(ShowLightboxEvent.type, this._handleShowLightbox);
  }

  private readonly _handleShowLightbox = (e: Event) => {
    this.show((e as ShowLightboxEvent).index);
  };

  private readonly _handleKeydown = (e: KeyboardEvent) => {
    if (!this.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.hide();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === 'ArrowRight') this._navigate(1);
    if (e.key === 'ArrowLeft') this._navigate(-1);
  };

  private _onBackdropClick() {
    this.hide();
  }

  private _onInfoClick(e: Event) {
    e.stopPropagation();
    if (this.photo !== null) {
      this.dispatchEvent(new ShowMetadataEvent(this.photo.uuid));
    }
  }

  override render() {
    if (this.photo === null) return nothing;
    const photo = this.photo;
    const effectiveDate = getEffectiveDate(photo);
    const loc = getEffectiveLocation(photo);

    return html`
      <div class="image-wrap" @click=${stopPropagation}>
        <img src=${getFullUrl(photo)} alt="" />
        <div class="camera-overlay ${photo.camera === null ? '' : 'visible'}">${photo.camera ?? ''}</div>
        <div class="play-overlay ${isVideo(photo) ? 'video' : ''}"></div>
        <div class="overlay-buttons">
          <button class="overlay-btn info-btn" @click=${(e: Event) => { this._onInfoClick(e); }} tabindex="-1"></button>
          ${photo.photos_url === undefined
            ? nothing
            : html`<a class="overlay-btn photos-btn" href=${photo.photos_url} target="_blank" tabindex="-1" @click=${(e: Event) => { e.stopPropagation(); }}></a>`}
        </div>
        <div class="info">${formatDate(effectiveDate, photo.tz)}<br>${formatCoords(loc)}</div>
      </div>
    `;
  }
}
