import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { getThumbUrl, formatDate } from '../../lib/utils';
import type { Photo } from '../../lib/types';

@customElement('placement-panel')
export class PlacementPanel extends LitElement {
  static override styles = css`
    :host { display: none; position: fixed; top: 12px; left: 12px; z-index: 1500; }
    :host([active]) { display: block; }
    .panel {
      background: #2c2c2e; border-radius: 10px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
      padding: 8px; max-width: 160px; text-align: center;
    }
    img { width: 144px; height: 108px; object-fit: cover; border-radius: 6px; display: block; }
    .info { font-size: 11px; color: #98989d; margin-top: 4px; }
    .hint { font-size: 11px; color: #666; margin-top: 4px; }
  `;

  @property({ type: Object }) photo: Photo | null = null;
  @property({ type: Boolean, reflect: true }) active = false;

  override render() {
    if (this.photo === null) return nothing;
    return html`
      <div class="panel">
        <img src=${getThumbUrl(this.photo)} alt="" />
        <div class="info">${formatDate(this.photo.date, this.photo.tz)}</div>
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
