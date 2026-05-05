import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';

import selection from '@common/selection';
import { formatDate, getThumbUrl } from '@common/utils';

@customElement('placement-panel')
export class PlacementPanel extends SignalWatcher(LitElement) {
  static override styles = css`
    :host {
      display: block;
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 1500;
    }
    .panel {
      background: #2c2c2e;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
      padding: 8px;
      max-width: 160px;
      text-align: center;
    }
    img {
      width: 144px;
      height: 108px;
      object-fit: cover;
      border-radius: 6px;
      display: block;
    }
    .info {
      font-size: 11px;
      color: #98989d;
      margin-top: 4px;
    }
    .hint {
      font-size: 11px;
      color: #666;
      margin-top: 4px;
    }
  `;

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- Lit lifecycle
  override render() {
    if (selection.interactionMode.get() !== 'placement') return nothing;
    const photo = selection.getPhoto();
    if (photo === undefined) return nothing;
    return html`
      <div class="panel">
        <img src=${getThumbUrl(photo)} alt="" />
        <div class="info">${formatDate(photo.date, photo.tz)}</div>
        <div class="hint">Click map to set location. Esc to cancel.</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'placement-panel': PlacementPanel;
  }
}
