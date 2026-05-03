import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  PlacementModeEvent,
  ShowLightboxEvent,
  ShowMetadataEvent
} from '@common/events';
import {
  editableDateStr,
  getEffectiveDate,
  getEffectiveLocation
} from '@common/photo-utils';
import type { Photo } from '@common/types';
import { formatCoords, formatDate, getThumbUrl, isVideo } from '@common/utils';

export interface PopupActions {
  copyLocation: () => void;
  pasteLocation: () => void;
  confirmLocation: () => void;
  copyDate: () => void;
  pasteDate: () => void;
  toggleDateEdit: () => void;
  adjustTime: (hours: number) => void;
  applyManualDate: (value: string) => void;
}

@customElement('photo-popup')
export class PhotoPopup extends LitElement {
  @property({ attribute: false }) photo: Photo | null = null;
  @property({ type: Number }) index = 0;
  @property({ type: Boolean }) dateEditMode = false;
  @property({ type: Boolean }) showPasteLocation = false;
  @property({ type: Boolean }) showPasteDate = false;
  @property({ attribute: false }) actions: PopupActions | null = null;

  static override styles = css`
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
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
    .action-buttons {
      display: inline-flex;
      gap: 2px;
      margin-left: 4px;
      vertical-align: middle;
    }
    .action-btn {
      padding: 1px 5px;
      font-size: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #f5f5f5;
      color: #666;
      cursor: pointer;
      line-height: 1.2;
    }
    .action-btn:hover {
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
      this.dispatchEvent(new PlacementModeEvent());
    }
  }

  private _applyManualDate() {
    const input = this.shadowRoot?.getElementById(
      'date-input'
    ) as HTMLInputElement | null;
    if (input !== null) {
      this.actions?.applyManualDate(input.value);
    }
  }

  private _onDateInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      this._applyManualDate();
    } else if (e.key === 'Escape') {
      this.actions?.toggleDateEdit();
    }
    // Stop all keydown propagation so external handlers (arrow nav, spacebar)
    // don't intercept keys meant for this input.
    e.stopPropagation();
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('dateEditMode') && this.dateEditMode) {
      const input = this.shadowRoot?.getElementById(
        'date-input'
      ) as HTMLInputElement | null;
      input?.focus();
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
        <span class="action-buttons">
          <button
            class="action-btn"
            @click=${() => {
              this.actions?.adjustTime(-24);
            }}
          >
            -1d
          </button>
          <button
            class="action-btn"
            @click=${() => {
              this.actions?.adjustTime(24);
            }}
          >
            +1d
          </button>
          <button
            class="action-btn"
            @click=${() => {
              this.actions?.adjustTime(-1);
            }}
          >
            -1h
          </button>
          <button
            class="action-btn"
            @click=${() => {
              this.actions?.adjustTime(1);
            }}
          >
            +1h
          </button>
          <button
            class="action-btn"
            @click=${() => {
              this.actions?.toggleDateEdit();
            }}
          >
            done
          </button>
        </span>
        <div class="date-edit-row">
          <input
            class="date-input"
            type="text"
            .value=${inputVal}
            id="date-input"
            @keydown=${(e: KeyboardEvent) => {
              this._onDateInputKey(e);
            }}
            @mousedown=${(e: Event) => {
              e.stopPropagation();
            }}
            @mousemove=${(e: Event) => {
              e.stopPropagation();
            }}
            @mouseup=${(e: Event) => {
              e.stopPropagation();
            }}
          />
          <button
            class="action-btn"
            @click=${() => {
              this._applyManualDate();
            }}
          >
            OK
          </button>
        </div>
      `;
    }

    return html`
      ${dateText}
      <span class="action-buttons">
        <button
          class="action-btn"
          @click=${() => {
            this.actions?.copyDate();
          }}
        >
          copy
        </button>
        <button
          class="action-btn"
          @click=${() => {
            this.actions?.pasteDate();
          }}
          style=${this.showPasteDate ? '' : 'display:none'}
        >
          paste
        </button>
        <button
          class="action-btn"
          @click=${() => {
            this.actions?.toggleDateEdit();
          }}
        >
          edit
        </button>
      </span>
    `;
  }

  private _renderLocationLine() {
    const photo = this.photo!;
    const loc = getEffectiveLocation(photo);

    return html`
      ${formatCoords(loc)}
      <span class="action-buttons">
        <button
          class="action-btn"
          @click=${(e: Event) => {
            this._onPlacement(e);
          }}
        >
          set
        </button>
        ${loc !== null && photo.gps === 'inferred'
          ? html`<button
              class="action-btn"
              @click=${() => {
                this.actions?.confirmLocation();
              }}
            >
              confirm
            </button>`
          : nothing}
        ${loc === null
          ? nothing
          : html`<button
              class="action-btn"
              @click=${() => {
                this.actions?.copyLocation();
              }}
            >
              copy
            </button>`}
        <button
          class="action-btn"
          @click=${() => {
            this.actions?.pasteLocation();
          }}
          style=${this.showPasteLocation ? '' : 'display:none'}
        >
          paste
        </button>
      </span>
    `;
  }

  override render() {
    if (this.photo === null) return nothing;
    const photo = this.photo;

    return html`
      <div class="photo-popup">
        <div class="popup-image-wrap">
          <img
            src=${getThumbUrl(photo)}
            alt="Photo"
            @click=${() => {
              this._onImgClick();
            }}
          />
          ${isVideo(photo)
            ? html`<div class="video-indicator"></div>`
            : nothing}
          <div class="overlay-buttons">
            <button
              class="overlay-btn info-btn"
              @click=${(e: Event) => {
                this._onInfoClick(e);
              }}
              tabindex="-1"
            ></button>
            ${photo.photos_url !== undefined && photo.photos_url !== ''
              ? html`<a
                  class="overlay-btn photos-btn"
                  href=${photo.photos_url}
                  target="_blank"
                  tabindex="-1"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                  }}
                ></a>`
              : nothing}
          </div>
        </div>
        <div class="info">
          ${this._renderDateLine()}<br />
          ${this._renderLocationLine()}
        </div>
      </div>
    `;
  }
}
