import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  AdjustTimeEvent,
  ApplyManualDateEvent,
  CopyDateEvent,
  CopyLocationEvent,
  EnterPlacementEvent,
  PasteDateEvent,
  PasteLocationEvent,
  ShowLightboxEvent,
  ShowMetadataEvent,
  ToggleDateEditEvent
} from '../../common/events';
import { editableDateStr, getEffectiveDate, getEffectiveLocation } from './popup-utils';
import type { Photo } from '../../common/types';
import { formatDate, formatLocation, getThumbUrl, isVideo } from '../../common/utils';
import { getCopiedDate, getCopiedLocation } from '../../common/data';

@customElement('photo-popup')
export class PhotoPopup extends LitElement {
  @property({ attribute: false }) photo: Photo | null = null;
  @property({ type: Number }) index = 0;
  @property({ type: Boolean }) dateEditMode = false;
  @property({ type: Boolean }) showPasteLocation = false;
  @property({ type: Boolean }) showPasteDate = false;

  static override styles = css`
    *, *::before, *::after { box-sizing: border-box; }
    :host {
      display: block;
    }
    .photo-popup {
      text-align: center;
      min-width: 280px;
    }
    .photo-popup img {
      max-width: 100%;
      max-height: 220px;
    }
    .info {
      margin: 8px 12px;
      font-size: 12px;
      color: #666;
    }
    .popup-image-wrap {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #111;
      min-height: 160px;
    }
    .video-indicator {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, calc(-50% + 5px));
      width: 48px;
      height: 48px;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 50%;
      pointer-events: none;
    }
    .video-indicator::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 54%;
      transform: translate(-50%, -50%);
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 10px 0 10px 18px;
      border-color: transparent transparent transparent white;
    }
    .overlay-buttons {
      position: absolute;
      top: 6px;
      right: 6px;
      display: flex;
      gap: 4px;
      z-index: 5;
    }
    .overlay-btn {
      width: 28px;
      height: 28px;
      background: rgba(0, 0, 0, 0.5);
      border: none;
      outline: none;
      border-radius: 6px;
      cursor: pointer;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 16px;
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
    .time-adjust-buttons {
      display: inline-flex;
      gap: 2px;
      margin-left: 4px;
      vertical-align: middle;
    }
    .time-btn {
      padding: 1px 5px;
      font-size: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #f5f5f5;
      color: #666;
      cursor: pointer;
      line-height: 1.2;
    }
    .time-btn:hover {
      background: #e0e0e0;
      border-color: #bbb;
    }
    .loc-buttons {
      display: inline-flex;
      gap: 2px;
      margin-left: 4px;
      vertical-align: middle;
    }
    .loc-btn {
      padding: 1px 5px;
      font-size: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #f5f5f5;
      color: #666;
      cursor: pointer;
      line-height: 1.2;
    }
    .loc-btn:hover {
      background: #e0e0e0;
      border-color: #bbb;
    }
    .date-edit-row {
      display: flex;
      gap: 4px;
      margin-top: 4px;
      align-items: center;
    }
    .date-input {
      flex: 1;
      padding: 2px 6px;
      font-size: 11px;
      border: 1px solid #ddd;
      border-radius: 4px;
      min-width: 0;
    }
    .date-input:focus {
      outline: none;
      border-color: #007aff;
    }
  `;

  private _onImgClick() {
    this.dispatchEvent(new ShowLightboxEvent(this.index));
  }

  private _onInfoClick(e: Event) {
    e.stopPropagation();
    if (this.photo !== null) {
      this.dispatchEvent(new ShowMetadataEvent(this.photo.uuid));
    }
  }

  private _onPlacement(e: Event) {
    e.preventDefault();
    if (this.photo !== null) {
      this.dispatchEvent(new EnterPlacementEvent(this.photo, this.index));
    }
  }

  private _onCopyLocation(e: Event) {
    e.preventDefault();
    this.dispatchEvent(new CopyLocationEvent());
  }

  private _onPasteLocation(e: Event) {
    e.preventDefault();
    this.dispatchEvent(new PasteLocationEvent());
  }

  private _onCopyDate(e: Event) {
    e.preventDefault();
    this.dispatchEvent(new CopyDateEvent());
  }

  private _onPasteDate(e: Event) {
    e.preventDefault();
    this.dispatchEvent(new PasteDateEvent());
  }

  private _onToggleDateEdit(e: Event) {
    e.preventDefault();
    this.dispatchEvent(new ToggleDateEditEvent());
  }

  private _onAdjustTime(hours: number, e: Event) {
    e.preventDefault();
    this.dispatchEvent(new AdjustTimeEvent(hours));
  }

  private _onApplyManualDate(e: Event) {
    e.preventDefault();
    const input = this.shadowRoot?.getElementById('date-input') as HTMLInputElement | null;
    if (input !== null) {
      this.dispatchEvent(new ApplyManualDateEvent(input.value));
    }
  }

  private _onDateInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = this.shadowRoot?.getElementById('date-input') as HTMLInputElement | null;
      if (input !== null) {
        this.dispatchEvent(new ApplyManualDateEvent(input.value));
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.dispatchEvent(new ToggleDateEditEvent());
    }
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('dateEditMode') && this.dateEditMode) {
      const input = this.shadowRoot?.getElementById('date-input') as HTMLInputElement | null;
      input?.focus();
    }
  }

  refreshPasteState() {
    if (this.photo === null) return;
    const copiedLoc = getCopiedLocation();
    if (copiedLoc === null) {
      this.showPasteLocation = false;
    } else {
      const loc = getEffectiveLocation(this.photo);
      this.showPasteLocation =
        copiedLoc.lat !== loc?.lat || copiedLoc.lon !== loc.lon;
    }
    const copiedDate = getCopiedDate();
    if (copiedDate === null) {
      this.showPasteDate = false;
    } else {
      const effectiveDate = getEffectiveDate(this.photo);
      this.showPasteDate = effectiveDate !== '' && effectiveDate !== copiedDate;
    }
  }

  private _renderDateLine() {
    const photo = this.photo!;
    const effectiveDate = getEffectiveDate(photo);
    const dateText = formatDate(effectiveDate, photo.tz);

    if (this.dateEditMode) {
      const inputVal = editableDateStr(effectiveDate);
      return html`
        ${dateText}
        <span class="time-adjust-buttons">
          <button class="time-btn" @click=${(e: Event) => { this._onAdjustTime(-24, e); }}>-1d</button>
          <button class="time-btn" @click=${(e: Event) => { this._onAdjustTime(24, e); }}>+1d</button>
          <button class="time-btn" @click=${(e: Event) => { this._onAdjustTime(-1, e); }}>-1h</button>
          <button class="time-btn" @click=${(e: Event) => { this._onAdjustTime(1, e); }}>+1h</button>
          <button class="time-btn" @click=${(e: Event) => { this._onToggleDateEdit(e); }}>done</button>
        </span>
        <div class="date-edit-row">
          <input class="date-input" type="text" .value=${inputVal} id="date-input" @keydown=${(e: KeyboardEvent) => { this._onDateInputKey(e); }} />
          <button class="time-btn" @click=${(e: Event) => { this._onApplyManualDate(e); }}>OK</button>
        </div>
      `;
    }

    return html`
      ${dateText}
      <span class="time-adjust-buttons">
        <button class="time-btn" @click=${(e: Event) => { this._onCopyDate(e); }}>copy</button>
        <button class="time-btn" @click=${(e: Event) => { this._onPasteDate(e); }} style=${this.showPasteDate ? '' : 'display:none'}>paste</button>
        <button class="time-btn" @click=${(e: Event) => { this._onToggleDateEdit(e); }}>edit</button>
      </span>
    `;
  }

  private _renderLocationLine() {
    const photo = this.photo!;
    const loc = getEffectiveLocation(photo);

    return html`
      ${formatLocation(photo)}
      <span class="loc-buttons">
        <button class="loc-btn" @click=${(e: Event) => { this._onPlacement(e); }}>set</button>
        ${loc === null ? nothing : html`<button class="loc-btn" @click=${(e: Event) => { this._onCopyLocation(e); }}>copy</button>`}
        <button class="loc-btn" @click=${(e: Event) => { this._onPasteLocation(e); }} style=${this.showPasteLocation ? '' : 'display:none'}>paste</button>
      </span>
    `;
  }

  override render() {
    if (this.photo === null) return nothing;
    const photo = this.photo;

    return html`
      <div class="photo-popup">
        <div class="popup-image-wrap">
          <img src=${getThumbUrl(photo)} alt="Photo" @click=${() => { this._onImgClick(); }} />
          ${isVideo(photo) ? html`<div class="video-indicator"></div>` : nothing}
          <div class="overlay-buttons">
            <button class="overlay-btn info-btn" @click=${(e: Event) => { this._onInfoClick(e); }} tabindex="-1"></button>
            ${photo.photos_url !== undefined && photo.photos_url !== ''
              ? html`<a class="overlay-btn photos-btn" href=${photo.photos_url} target="_blank" tabindex="-1" @click=${(e: Event) => { e.stopPropagation(); }}></a>`
              : nothing}
          </div>
        </div>
        <div class="info">
          ${this._renderDateLine()}<br>
          ${this._renderLocationLine()}
        </div>
      </div>
    `;
  }
}
