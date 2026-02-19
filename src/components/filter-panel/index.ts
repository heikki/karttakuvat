import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state as litState } from 'lit/decorators.js';

import { applyFilters } from '../../lib/data';
import {
  filtersFromUrl, filtersToUrl, mapStyleFromUrl, mapStyleToUrl,
  markerStyleFromUrl, markerStyleToUrl, tracksVisibleFromUrl, tracksVisibleToUrl
} from '../../lib/filter-url';
import { StoreController } from '../../lib/store-controller';
import { getYear, isVideo } from '../../lib/utils';

const DEFAULT_GPS = ['exif', 'inferred', 'user', 'none'];
const DEFAULT_MEDIA = ['photo', 'video'];

function renderSelect(label: string, options: string[], value: string, onChange: (e: Event) => void) {
  return html`
    <label>${label}</label>
    <select @change=${onChange}>
      <option value="all" ?selected=${value === 'all'}>All</option>
      ${options.map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}
    </select>
  `;
}

function renderStyleBtns(items: Array<{ style: string; label: string }>, active: string, onClick: (s: string) => void) {
  return html`
    <div class="map-type-buttons">
      ${items.map((i) => html`
        <button class="map-type-btn ${i.style === active ? 'active' : ''}" @click=${() => { onClick(i.style); }}>${i.label}</button>
      `)}
    </div>
  `;
}

@customElement('filter-panel')
export class FilterPanel extends LitElement {
  private readonly _store = new StoreController(this);

  @litState() private _year = 'all';
  @litState() private _album = 'all';
  @litState() private _camera = 'all';
  @litState() private _gps: string[] = [...DEFAULT_GPS];
  @litState() private _media: string[] = [...DEFAULT_MEDIA];
  @litState() private _collapsed = false;
  @litState() private _mapStyle = 'satellite';
  @litState() private _markerStyle = 'classic';
  @litState() private _measureActive = false;
  @litState() private _tracksVisible = true;
  @litState() private _tracksAvailable = false;

  @property({ type: Boolean }) saving = false;

  private _gpsClickTimer: ReturnType<typeof setTimeout> | null = null;
  private _mediaClickTimer: ReturnType<typeof setTimeout> | null = null;

  static override styles = css`
    :host {
      display: block; position: absolute; top: 10px; right: 10px;
      background: #2c2c2e; padding: 15px; border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5); z-index: 1000; width: 220px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    h2 { font-size: 16px; margin: 0 0 10px 0; color: #e5e5e7; }
    p { font-size: 13px; color: #98989d; margin: 4px 0; }
    .panel-header { cursor: pointer; user-select: none; }
    .panel-body { margin-top: 12px; border-top: 1px solid #3a3a3c; padding-top: 12px; }
    label { font-size: 12px; color: #98989d; display: block; margin-bottom: 4px; }
    select {
      width: 100%; padding: 6px 8px; background: #3a3a3c; color: #e5e5e7;
      border: 1px solid #48484a; border-radius: 6px; font-size: 13px;
      cursor: pointer; margin-bottom: 8px;
    }
    .map-type-buttons, .filter-buttons {
      display: flex; gap: 0; margin-bottom: 8px; border-radius: 6px;
      overflow: hidden; border: 1px solid #48484a;
    }
    .map-type-btn, .filter-btn {
      flex: 1; padding: 5px 0; border: none; border-right: 1px solid #48484a;
      background: #3a3a3c; color: #98989d; font-size: 11px; cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .map-type-btn:last-child, .filter-btn:last-child { border-right: none; }
    .map-type-btn:hover, .filter-btn:hover { background: #48484a; }
    .map-type-btn.active { background: #007aff; color: white; }
    .filter-btn.active { background: var(--btn-color, #007aff); color: white; }
    .view-buttons {
      display: flex; gap: 6px; margin-top: 12px; padding-top: 12px;
      border-top: 1px solid #3a3a3c;
    }
    .view-btn {
      flex: 1; padding: 5px 10px; border: 1px solid #48484a; border-radius: 6px;
      background: #3a3a3c; color: #e5e5e7; font-size: 12px; cursor: pointer;
    }
    .view-btn:hover { background: #48484a; border-color: #48484a; }
    .view-btn.active { background: #007aff; color: white; border-color: #007aff; }
    .edit-section {
      margin-top: 12px; padding-top: 12px; border-top: 1px solid #3a3a3c;
      font-size: 13px; color: #e5e5e7;
    }
    .count { font-weight: bold; color: #f59e0b; }
    .edit-buttons { display: flex; gap: 8px; margin-top: 8px; }
    .edit-buttons button {
      flex: 1; padding: 6px 10px; border: none; border-radius: 6px;
      font-size: 12px; cursor: pointer; background: #007aff; color: white;
    }
    .edit-buttons button:hover { opacity: 0.9; }
    .edit-buttons button.secondary { background: #3a3a3c; color: #e5e5e7; }
    .edit-buttons button.secondary:hover { background: #48484a; }
    .edit-buttons button:disabled { opacity: 0.5; cursor: not-allowed; }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this._restoreFromUrl();
    document.addEventListener('gpx-data-changed', this._onGpxDataChanged);
    document.addEventListener('measure-mode-exited', this._onMeasureExited);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('gpx-data-changed', this._onGpxDataChanged);
    document.removeEventListener('measure-mode-exited', this._onMeasureExited);
  }

  private readonly _onGpxDataChanged = (e: Event) => {
    this._tracksAvailable = (e as CustomEvent).detail as boolean;
  };

  private readonly _onMeasureExited = () => { this._measureActive = false; };

  private _restoreFromUrl() {
    const saved = filtersFromUrl();
    if (saved !== null) {
      if (saved.year !== undefined) this._year = saved.year;
      if (saved.album !== undefined) this._album = saved.album;
      if (saved.camera !== undefined) this._camera = saved.camera;
      if (saved.gps !== undefined) this._gps = saved.gps;
      if (saved.media !== undefined) this._media = saved.media;
    }
    const ms = mapStyleFromUrl();
    if (ms !== null) this._mapStyle = ms;
    const mk = markerStyleFromUrl();
    if (mk !== null) this._markerStyle = mk;
    this._tracksVisible = tracksVisibleFromUrl();
  }

  applyInitialFilters() {
    const ao = this._getAlbumOptions();
    if (this._album !== 'all' && !ao.includes(this._album)) this._album = 'all';
    const co = this._getCameraOptions();
    if (this._camera !== 'all' && !co.includes(this._camera)) this._camera = 'all';
    this._applyFilters();
    this._dispatch('map-style-change', this._mapStyle);
    this._dispatch('marker-style-change', this._markerStyle);
    this._dispatch('toggle-tracks', this._tracksVisible);
  }

  private _dispatch(type: string, detail?: unknown) {
    this.dispatchEvent(
      detail === undefined
        ? new Event(type, { bubbles: true, composed: true })
        : new CustomEvent(type, { bubbles: true, composed: true, detail })
    );
  }

  private _getYearPhotos() {
    return this._year === 'all'
      ? this._store.photos
      : this._store.photos.filter((p) => getYear(p) === this._year);
  }

  private _getAlbumOptions() {
    return [...new Set(this._getYearPhotos().flatMap((p) => p.albums))].sort();
  }

  private _getAlbumPhotos() {
    const yp = this._getYearPhotos();
    return this._album === 'all' ? yp : yp.filter((p) => p.albums.includes(this._album));
  }

  private _getCameraOptions() {
    return [...new Set(this._getAlbumPhotos().map((p) => p.camera ?? '(unknown)'))].sort();
  }

  private _getCameraPhotos() {
    const ap = this._getAlbumPhotos();
    return this._camera === 'all' ? ap : ap.filter((p) => (p.camera ?? '(unknown)') === this._camera);
  }

  private _applyFilters() {
    applyFilters(
      { year: this._year, gps: this._gps, media: this._media, album: this._album, camera: this._camera },
      this._getCameraPhotos()
    );
    filtersToUrl({ year: this._year, album: this._album, camera: this._camera, gps: this._gps, media: this._media });
  }

  private readonly _onYearChange = (e: Event) => {
    this._year = (e.target as HTMLSelectElement).value;
    const ao = this._getAlbumOptions();
    if (this._album !== 'all' && !ao.includes(this._album)) this._album = 'all';
    const co = this._getCameraOptions();
    if (this._camera !== 'all' && !co.includes(this._camera)) this._camera = 'all';
    this._applyFilters();
  };

  private readonly _onAlbumChange = (e: Event) => {
    this._album = (e.target as HTMLSelectElement).value;
    const co = this._getCameraOptions();
    if (this._camera !== 'all' && !co.includes(this._camera)) this._camera = 'all';
    this._applyFilters();
  };

  private readonly _onCameraChange = (e: Event) => {
    this._camera = (e.target as HTMLSelectElement).value;
    this._applyFilters();
  };

  private _onGpsClick(value: string) {
    if (this._gpsClickTimer !== null) return;
    this._gpsClickTimer = setTimeout(() => {
      this._gpsClickTimer = null;
      this._gps = this._gps.includes(value)
        ? this._gps.filter((v) => v !== value) : [...this._gps, value];
      this._applyFilters();
    }, 250);
  }

  private _onMediaClick(value: string) {
    if (this._mediaClickTimer !== null) return;
    this._mediaClickTimer = setTimeout(() => {
      this._mediaClickTimer = null;
      this._media = this._media.includes(value)
        ? this._media.filter((v) => v !== value) : [...this._media, value];
      this._applyFilters();
    }, 250);
  }

  private _onGpsDblClick(value: string) {
    if (this._gpsClickTimer !== null) { clearTimeout(this._gpsClickTimer); this._gpsClickTimer = null; }
    const solo = this._gps.length === 1 && this._gps[0] === value;
    this._gps = solo ? [...DEFAULT_GPS] : [value];
    this._applyFilters();
  }

  private _onMediaDblClick(value: string) {
    if (this._mediaClickTimer !== null) { clearTimeout(this._mediaClickTimer); this._mediaClickTimer = null; }
    const solo = this._media.length === 1 && this._media[0] === value;
    this._media = solo ? [...DEFAULT_MEDIA] : [value];
    this._applyFilters();
  }

  private _onReset() {
    this._year = 'all'; this._album = 'all'; this._camera = 'all';
    this._gps = [...DEFAULT_GPS]; this._media = [...DEFAULT_MEDIA];
    if (this._mapStyle !== 'satellite') { this._mapStyle = 'satellite'; mapStyleToUrl('satellite'); }
    this._measureActive = false;
    this._applyFilters();
    history.replaceState(null, '', location.pathname);
    this._dispatch('reset-app');
  }

  private _renderStats() {
    const filtered = this._store.filteredPhotos;
    if (filtered.length === 0) return 'No results';
    const pc = filtered.filter((p) => !isVideo(p)).length;
    const vc = filtered.filter((p) => isVideo(p)).length;
    if (pc > 0 && vc > 0) return `${pc} photos, ${vc} videos`;
    return vc > 0 ? `${vc} videos` : `${pc} photos`;
  }

  private _renderFilterBtns(group: 'gps' | 'media', items: Array<{ value: string; label: string; color?: string }>) {
    const active = group === 'gps' ? this._gps : this._media;
    const onClick = group === 'gps' ? (v: string) => { this._onGpsClick(v); } : (v: string) => { this._onMediaClick(v); };
    const onDbl = group === 'gps' ? (v: string) => { this._onGpsDblClick(v); } : (v: string) => { this._onMediaDblClick(v); };
    return html`
      <div class="filter-buttons">
        ${items.map((i) => html`
          <button class="filter-btn ${active.includes(i.value) ? 'active' : ''}"
            style=${i.color === undefined ? '' : `--btn-color: ${i.color}`}
            @click=${() => { onClick(i.value); }} @dblclick=${() => { onDbl(i.value); }}
          >${i.label}</button>
        `)}
      </div>
    `;
  }

  override render() {
    const years = [...new Set(this._store.photos.map(getYear).filter((y): y is string => y !== null))].sort();
    const ec = this._store.editCount;
    return html`
      <div class="panel-header" @click=${() => { this._collapsed = !this._collapsed; }}>
        <h2>Karttakuvat</h2><p>${this._renderStats()}</p>
      </div>
      ${this._collapsed ? nothing : html`
        <div class="panel-body">
          ${renderSelect('Year', years, this._year, this._onYearChange)}
          ${renderSelect('Album', this._getAlbumOptions(), this._album, this._onAlbumChange)}
          ${renderSelect('Camera', this._getCameraOptions(), this._camera, this._onCameraChange)}
          <label>Media</label>
          ${this._renderFilterBtns('media', [{ value: 'photo', label: 'Photos' }, { value: 'video', label: 'Videos' }])}
          <label>Location</label>
          ${this._renderFilterBtns('gps', [
            { value: 'exif', label: 'Exif', color: '#3b82f6' }, { value: 'inferred', label: 'Inferred', color: '#f59e0b' },
            { value: 'user', label: 'User', color: '#22c55e' }, { value: 'none', label: 'None', color: '#9ca3af' }
          ])}
          <label>Map</label>
          ${renderStyleBtns(
            [{ style: 'satellite', label: 'Aerial' }, { style: 'topo', label: 'Topo' },
             { style: 'mml_maastokartta', label: 'Maasto' }, { style: 'mml_ortokuva', label: 'Orto' }],
            this._mapStyle, (s) => { this._mapStyle = s; mapStyleToUrl(s); this._dispatch('map-style-change', s); }
          )}
          <label>Markers</label>
          ${renderStyleBtns(
            [{ style: 'points', label: 'Points' }, { style: 'classic', label: 'Classic' }],
            this._markerStyle, (s) => { this._markerStyle = s; markerStyleToUrl(s); this._dispatch('marker-style-change', s); }
          )}
          <div class="view-buttons">
            <button class="view-btn" @click=${() => { this._dispatch('fit-view'); }}>Fit</button>
            <button class="view-btn" @click=${() => { this._onReset(); }}>Reset</button>
            <button class="view-btn ${this._measureActive ? 'active' : ''}" @click=${() => {
              this._measureActive = !this._measureActive;
              this._dispatch('toggle-measure', this._measureActive);
            }}>Measure</button>
          </div>
          ${this._tracksAvailable ? html`
            <div class="view-buttons">
              <button class="view-btn ${this._tracksVisible ? 'active' : ''}" @click=${() => {
                this._tracksVisible = !this._tracksVisible;
                tracksVisibleToUrl(this._tracksVisible);
                this._dispatch('toggle-tracks', this._tracksVisible);
              }}>Tracks</button>
            </div>` : nothing}
          <div class="view-buttons">
            <button class="view-btn" @click=${() => { this._dispatch('open-apple-maps'); }}>Apple Maps</button>
            <button class="view-btn" @click=${() => { this._dispatch('open-google-maps'); }}>Google Maps</button>
          </div>
          ${ec > 0 ? html`
            <div class="edit-section">
              <span class="count">${ec}</span> pending edits
              <div class="edit-buttons">
                <button ?disabled=${this.saving} @click=${() => { this._dispatch('save-edits'); }}>
                  ${this.saving ? 'Saving...' : 'Save to Photos'}</button>
                <button class="secondary" @click=${() => { this._dispatch('discard-edits'); }}>Discard</button>
              </div>
            </div>` : nothing}
        </div>
      `}
    `;
  }
}
