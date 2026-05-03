import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { ShowAlbumFilesEvent, ToggleRouteEditEvent } from '@common/events';
import { viewState } from '@common/view-state';

import selection from '../../map/selection';
import { styles } from './styles';

@customElement('album-controls')
export class AlbumControls extends SignalWatcher(LitElement) {
  @property() album = 'all';
  private _albumInitialized = false;

  static override styles = styles;

  override willUpdate(changed: PropertyValues) {
    if (!changed.has('album')) return;
    if (!this._albumInitialized) {
      this._albumInitialized = true;
      return;
    }
    if (!viewState.routeVisible.get()) return;
    if (selection.interactionMode.get() === 'route-edit') {
      selection.interactionMode.set('idle');
    }
    if (this.album === 'all') viewState.routeVisible.set(false);
  }

  override render() {
    const disabled = this.album === 'all';
    const routeActive = viewState.routeVisible.get();
    const editActive = selection.interactionMode.get() === 'route-edit';
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
          class="view-btn ${routeActive ? 'active' : ''}"
          ?disabled=${disabled}
          @click=${() => {
            if (routeActive && editActive) {
              selection.interactionMode.set('idle');
            }
            viewState.routeVisible.set(!routeActive);
          }}
        >
          Route
        </button>
        <button
          class="view-btn ${editActive ? 'active' : ''}"
          ?disabled=${disabled || !routeActive}
          @click=${() => {
            document.dispatchEvent(new ToggleRouteEditEvent());
          }}
        >
          Edit
        </button>
      </div>
    `;
  }
}
