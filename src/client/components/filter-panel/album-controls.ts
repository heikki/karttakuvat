import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, state as litState, property } from 'lit/decorators.js';

import {
  RouteEditModeEvent,
  RouteVisibilityEvent,
  ShowAlbumFilesEvent,
  ToggleRouteEditEvent
} from '@common/events';
import { routeFromUrl, routeToUrl } from '@common/filter-url';

import { styles } from './styles';

@customElement('album-controls')
export class AlbumControls extends LitElement {
  @property() album = 'all';
  @litState() private _routeActive = false;
  @litState() private _routeEditActive = false;
  private _albumInitialized = false;

  static override styles = styles;

  override connectedCallback() {
    super.connectedCallback();
    this._routeActive = routeFromUrl();
    document.addEventListener(
      RouteEditModeEvent.type,
      this._onRouteEditModeChange
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(
      RouteEditModeEvent.type,
      this._onRouteEditModeChange
    );
  }

  private readonly _onRouteEditModeChange = (e: RouteEditModeEvent) => {
    this._routeEditActive = e.active;
  };

  override willUpdate(changed: PropertyValues) {
    if (changed.has('album')) {
      if (!this._albumInitialized) {
        this._albumInitialized = true;
        return;
      }
      if (this._routeActive) {
        this._exitRouteEdit();
        if (this.album === 'all') {
          this._routeActive = false;
          routeToUrl(false);
          document.dispatchEvent(new RouteVisibilityEvent(false));
        }
      }
    }
  }

  /** Reset route state (called by parent on full reset). */
  reset(): void {
    this._exitRouteEdit();
    if (this._routeActive) {
      this._routeActive = false;
      document.dispatchEvent(new RouteVisibilityEvent(false));
    }
  }

  /** Activate route display if URL indicated it should be on. */
  applyInitialState(): void {
    if (this._routeActive) {
      document.dispatchEvent(new RouteVisibilityEvent(true));
    }
  }

  private _exitRouteEdit(): void {
    if (this._routeEditActive) {
      this._routeEditActive = false;
      document.dispatchEvent(new ToggleRouteEditEvent());
    }
  }

  override render() {
    const disabled = this.album === 'all';
    return html`
      <div class="view-buttons">
        <button
          class="view-btn"
          ?disabled=${disabled}
          @click=${() => {
            document.dispatchEvent(new ShowAlbumFilesEvent(this.album));
          }}
        >
          Files
        </button>
        <button
          class="view-btn ${this._routeActive ? 'active' : ''}"
          ?disabled=${disabled}
          @click=${() => {
            if (this._routeActive) this._exitRouteEdit();
            this._routeActive = !this._routeActive;
            routeToUrl(this._routeActive);
            document.dispatchEvent(new RouteVisibilityEvent(this._routeActive));
          }}
        >
          Route
        </button>
        <button
          class="view-btn ${this._routeEditActive ? 'active' : ''}"
          ?disabled=${disabled || !this._routeActive}
          @click=${() => {
            this._routeEditActive = !this._routeEditActive;
            document.dispatchEvent(new ToggleRouteEditEvent());
          }}
        >
          Edit
        </button>
      </div>
    `;
  }
}
