import { css, html, LitElement, nothing } from 'lit';
import { customElement, state as litState, property } from 'lit/decorators.js';

import { getApiBase } from '@common/api';
import { ShowAlbumFilesEvent } from '@common/events';

@customElement('album-files-modal')
export class AlbumFilesModal extends LitElement {
  @property({ type: Boolean, reflect: true }) active = false;
  @litState() private _files: string[] = [];
  @litState() private _loading = false;
  @litState() private _album = '';

  static override styles = css`
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    :host {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      z-index: 3000;
      justify-content: center;
      align-items: center;
    }
    :host([active]) {
      display: flex;
    }
    .content {
      background: #1c1c1e;
      color: #e5e5e7;
      border-radius: 12px;
      max-width: 440px;
      width: 90%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid #333;
      font-weight: 600;
      font-size: 14px;
    }
    .close {
      font-size: 24px;
      cursor: pointer;
      color: #888;
      line-height: 1;
    }
    .close:hover {
      color: #ccc;
    }
    .body {
      padding: 12px 16px;
      overflow-y: auto;
      font-size: 13px;
      line-height: 1.5;
    }
    .file-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid #2c2c2e;
    }
    .file-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .delete-btn {
      background: none;
      border: none;
      color: #ff453a;
      cursor: pointer;
      font-size: 13px;
      padding: 2px 8px;
      flex-shrink: 0;
      border-radius: 4px;
    }
    .delete-btn:hover {
      background: rgba(255, 69, 58, 0.15);
    }
    .empty {
      color: #888;
      text-align: center;
      padding: 16px 0;
    }
    .loading {
      text-align: center;
      padding: 24px;
      color: #888;
    }
    .footer {
      padding: 12px 16px;
      border-top: 1px solid #333;
    }
    .add-btn {
      background: #0a84ff;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 13px;
      cursor: pointer;
      width: 100%;
    }
    .add-btn:hover {
      background: #0070e0;
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this.addEventListener('click', this._onHostClick);
    document.addEventListener('keydown', this._onKeydown, true);
    document.addEventListener(ShowAlbumFilesEvent.type, this._onShowAlbumFiles);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this._onHostClick);
    document.removeEventListener('keydown', this._onKeydown, true);
    document.removeEventListener(
      ShowAlbumFilesEvent.type,
      this._onShowAlbumFiles
    );
  }

  private readonly _onShowAlbumFiles = (e: ShowAlbumFilesEvent) => {
    this._album = e.album;
    this.active = true;
    this._fetchFiles();
  };

  private readonly _onHostClick = (e: Event) => {
    if (e.target === this) this._close();
  };

  private readonly _onKeydown = (e: KeyboardEvent) => {
    if (!this.active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this._close();
      return;
    }
    e.stopImmediatePropagation();
  };

  private _close() {
    this.active = false;
  }

  private async _fetchFiles() {
    this._loading = true;
    try {
      const res = await fetch(
        `${getApiBase()}/api/albums/${encodeURIComponent(this._album)}/files`
      );
      this._files = (await res.json()) as string[];
    } catch {
      this._files = [];
    }
    this._loading = false;
  }

  private async _deleteFile(filename: string) {
    try {
      const res = await fetch(
        `${getApiBase()}/api/albums/${encodeURIComponent(this._album)}/files/${encodeURIComponent(filename)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        this._files = this._files.filter((f) => f !== filename);
        if (filename.toLowerCase().endsWith('.gpx')) {
          const { reloadGpxTracks } = await import('../../map/gpx');
          reloadGpxTracks();
        }
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  private _onAddClick() {
    const input =
      this.renderRoot.querySelector<HTMLInputElement>('input[type="file"]');
    input?.click();
  }

  private readonly _onFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (files === null || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('file', files[i]!);
    }

    try {
      const res = await fetch(
        `${getApiBase()}/api/albums/${encodeURIComponent(this._album)}/upload`,
        { method: 'POST', body: formData }
      );
      if (res.ok) {
        await this._fetchFiles();
        const hasGpx = Array.from(files).some((f) =>
          f.name.toLowerCase().endsWith('.gpx')
        );
        if (hasGpx) {
          const { reloadGpxTracks } = await import('../../map/gpx');
          reloadGpxTracks();
        }
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }

    input.value = '';
  };

  override render() {
    return html`
      <div
        class="content"
        @click=${(e: Event) => {
          e.stopPropagation();
        }}
      >
        <div class="header">
          <span>Files — ${this._album}</span>
          <span
            class="close"
            @click=${() => {
              this._close();
            }}
            >&times;</span
          >
        </div>
        <div class="body">
          ${this._loading
            ? html`<div class="loading">Loading...</div>`
            : nothing}
          ${!this._loading && this._files.length === 0
            ? html`<div class="empty">No files</div>`
            : nothing}
          ${this._files.map(
            (f) => html`
              <div class="file-row">
                <span class="file-name">${f}</span>
                <button
                  class="delete-btn"
                  @click=${() => {
                    void this._deleteFile(f);
                  }}
                >
                  Delete
                </button>
              </div>
            `
          )}
        </div>
        <div class="footer">
          <button
            class="add-btn"
            @click=${() => {
              this._onAddClick();
            }}
          >
            Add files...
          </button>
          <input
            type="file"
            accept=".gpx,.md"
            multiple
            style="display:none"
            @change=${this._onFileChange}
          />
        </div>
      </div>
    `;
  }
}
