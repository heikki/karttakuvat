import { html, LitElement, nothing } from 'lit';
import { customElement, state as litState } from 'lit/decorators.js';

import { applyFilters, clearPendingEdits } from '@common/data';
import {
  ChangeMapStyleEvent,
  ChangeMarkerStyleEvent,
  FitToPhotosEvent,
  GpxDataChangedEvent,
  MeasureModeExitedEvent,
  OpenExternalMapEvent,
  ResetMapEvent,
  SaveEditsEvent,
  SetGpxVisibleEvent,
  ToggleMeasureModeEvent
} from '@common/events';
import {
  filtersFromUrl,
  filtersToUrl,
  mapStyleFromUrl,
  mapStyleToUrl,
  markerStyleFromUrl,
  markerStyleToUrl,
  tracksVisibleFromUrl,
  tracksVisibleToUrl
} from '@common/filter-url';
import { getYear, isVideo } from '@common/utils';

import { StoreController } from './store-controller';
import { styles } from './styles';

const DEFAULT_GPS = ['exif', 'inferred', 'user', 'none'];
const DEFAULT_MEDIA = ['photo', 'video'];

function renderSelect(
  label: string,
  options: string[],
  value: string,
  onChange: (e: Event) => void
) {
  return html`
    <label>${label}</label>
    <select @change=${onChange}>
      <option value="all" ?selected=${value === 'all'}>All</option>
      ${options.map(
        (o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`
      )}
    </select>
  `;
}

function renderStyleBtns(
  items: Array<{ style: string; label: string }>,
  active: string,
  onClick: (s: string) => void
) {
  return html`
    <div class="map-type-buttons">
      ${items.map(
        (i) => html`
          <button
            class="map-type-btn ${i.style === active ? 'active' : ''}"
            @click=${() => {
              onClick(i.style);
            }}
          >
            ${i.label}
          </button>
        `
      )}
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

  private _initialized = false;
  private _gpsClickTimer: ReturnType<typeof setTimeout> | null = null;
  private _mediaClickTimer: ReturnType<typeof setTimeout> | null = null;

  static override styles = styles;

  override connectedCallback() {
    super.connectedCallback();
    this._restoreFromUrl();
    document.addEventListener(GpxDataChangedEvent.type, this._onGpxDataChanged);
    document.addEventListener(
      MeasureModeExitedEvent.type,
      this._onMeasureExited
    );
  }

  override updated() {
    if (!this._initialized && this._store.photos.length > 0) {
      this._initialized = true;
      this._applyInitialFilters();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(
      GpxDataChangedEvent.type,
      this._onGpxDataChanged
    );
    document.removeEventListener(
      MeasureModeExitedEvent.type,
      this._onMeasureExited
    );
  }

  private readonly _onGpxDataChanged = (e: GpxDataChangedEvent) => {
    this._tracksAvailable = e.available;
  };

  private readonly _onMeasureExited = () => {
    this._measureActive = false;
  };

  private _restoreFromUrl() {
    const saved = filtersFromUrl();
    if (saved !== null) {
      if (saved.year !== undefined) this._year = saved.year;
      if (saved.album !== undefined) this._album = saved.album;
      if (saved.camera !== undefined) this._camera = saved.camera;
      if (saved.gps !== undefined) this._gps = saved.gps;
      if (saved.media !== undefined) this._media = saved.media;
    }
    const mapStyle = mapStyleFromUrl();
    if (mapStyle !== null) this._mapStyle = mapStyle;
    const markerStyle = markerStyleFromUrl();
    if (markerStyle !== null) this._markerStyle = markerStyle;
    this._tracksVisible = tracksVisibleFromUrl();
  }

  private _applyInitialFilters() {
    const albumOpts = this._getAlbumOptions();
    if (this._album !== 'all' && !albumOpts.includes(this._album)) this._album = 'all';
    const cameraOpts = this._getCameraOptions();
    if (this._camera !== 'all' && !cameraOpts.includes(this._camera)) {
      this._camera = 'all';
    }
    this._applyFilters();
    document.dispatchEvent(new ChangeMapStyleEvent(this._mapStyle));
    document.dispatchEvent(new ChangeMarkerStyleEvent(this._markerStyle));
    document.dispatchEvent(new SetGpxVisibleEvent(this._tracksVisible));
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
    const yearPhotos = this._getYearPhotos();
    return this._album === 'all'
      ? yearPhotos
      : yearPhotos.filter((p) => p.albums.includes(this._album));
  }

  private _getCameraOptions() {
    return [
      ...new Set(this._getAlbumPhotos().map((p) => p.camera ?? '(unknown)'))
    ].sort();
  }

  private _getCameraPhotos() {
    const albumPhotos = this._getAlbumPhotos();
    return this._camera === 'all'
      ? albumPhotos
      : albumPhotos.filter((p) => (p.camera ?? '(unknown)') === this._camera);
  }

  private _applyFilters() {
    applyFilters(
      {
        year: this._year,
        gps: this._gps,
        media: this._media,
        album: this._album,
        camera: this._camera
      },
      this._getCameraPhotos()
    );
    filtersToUrl({
      year: this._year,
      album: this._album,
      camera: this._camera,
      gps: this._gps,
      media: this._media
    });
  }

  private readonly _onYearChange = (e: Event) => {
    this._year = (e.target as HTMLSelectElement).value;
    const albumOpts = this._getAlbumOptions();
    if (this._album !== 'all' && !albumOpts.includes(this._album)) this._album = 'all';
    const cameraOpts = this._getCameraOptions();
    if (this._camera !== 'all' && !cameraOpts.includes(this._camera)) {
      this._camera = 'all';
    }
    this._applyFilters();
  };

  private readonly _onAlbumChange = (e: Event) => {
    this._album = (e.target as HTMLSelectElement).value;
    const cameraOpts = this._getCameraOptions();
    if (this._camera !== 'all' && !cameraOpts.includes(this._camera)) {
      this._camera = 'all';
    }
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
        ? this._gps.filter((v) => v !== value)
        : [...this._gps, value];
      this._applyFilters();
    }, 250);
  }

  private _onMediaClick(value: string) {
    if (this._mediaClickTimer !== null) return;
    this._mediaClickTimer = setTimeout(() => {
      this._mediaClickTimer = null;
      this._media = this._media.includes(value)
        ? this._media.filter((v) => v !== value)
        : [...this._media, value];
      this._applyFilters();
    }, 250);
  }

  private _onGpsDblClick(value: string) {
    if (this._gpsClickTimer !== null) {
      clearTimeout(this._gpsClickTimer);
      this._gpsClickTimer = null;
    }
    const solo = this._gps.length === 1 && this._gps[0] === value;
    this._gps = solo ? [...DEFAULT_GPS] : [value];
    this._applyFilters();
  }

  private _onMediaDblClick(value: string) {
    if (this._mediaClickTimer !== null) {
      clearTimeout(this._mediaClickTimer);
      this._mediaClickTimer = null;
    }
    const solo = this._media.length === 1 && this._media[0] === value;
    this._media = solo ? [...DEFAULT_MEDIA] : [value];
    this._applyFilters();
  }

  private _onReset() {
    this._year = 'all';
    this._album = 'all';
    this._camera = 'all';
    this._gps = [...DEFAULT_GPS];
    this._media = [...DEFAULT_MEDIA];
    if (this._mapStyle !== 'satellite') {
      this._mapStyle = 'satellite';
      mapStyleToUrl('satellite');
    }
    this._measureActive = false;
    this._applyFilters();
    history.replaceState(null, '', location.pathname);
    document.dispatchEvent(new ResetMapEvent());
  }

  private _renderStats() {
    const filtered = this._store.filteredPhotos;
    if (filtered.length === 0) return 'No results';
    const pc = filtered.filter((p) => !isVideo(p)).length;
    const vc = filtered.filter((p) => isVideo(p)).length;
    if (pc > 0 && vc > 0) return `${pc} photos, ${vc} videos`;
    return vc > 0 ? `${vc} videos` : `${pc} photos`;
  }

  private _renderFilterBtns(
    group: 'gps' | 'media',
    items: Array<{ value: string; label: string; color?: string }>
  ) {
    const active = group === 'gps' ? this._gps : this._media;
    const onClick =
      group === 'gps'
        ? (v: string) => {
            this._onGpsClick(v);
          }
        : (v: string) => {
            this._onMediaClick(v);
          };
    const onDbl =
      group === 'gps'
        ? (v: string) => {
            this._onGpsDblClick(v);
          }
        : (v: string) => {
            this._onMediaDblClick(v);
          };
    return html`
      <div class="filter-buttons">
        ${items.map(
          (i) => html`
            <button
              class="filter-btn ${active.includes(i.value) ? 'active' : ''}"
              style=${i.color === undefined ? '' : `--btn-color: ${i.color}`}
              @click=${() => {
                onClick(i.value);
              }}
              @dblclick=${() => {
                onDbl(i.value);
              }}
            >
              ${i.label}
            </button>
          `
        )}
      </div>
    `;
  }

  override render() {
    const years = [
      ...new Set(
        this._store.photos.map(getYear).filter((y): y is string => y !== null)
      )
    ].sort();
    const editCount = this._store.editCount;
    return html`
      <div class="wrapper">
        <div
          class="panel-header"
          @click=${() => {
            this._collapsed = !this._collapsed;
          }}
        >
          <h2>Karttakuvat</h2>
          <p>${this._renderStats()}</p>
        </div>
        ${this._collapsed
          ? nothing
          : html`
              <div class="panel-body">
                ${renderSelect('Year', years, this._year, this._onYearChange)}
                ${renderSelect(
                  'Album',
                  this._getAlbumOptions(),
                  this._album,
                  this._onAlbumChange
                )}
                ${renderSelect(
                  'Camera',
                  this._getCameraOptions(),
                  this._camera,
                  this._onCameraChange
                )}
                <label>Media</label>
                ${this._renderFilterBtns('media', [
                  { value: 'photo', label: 'Photos' },
                  { value: 'video', label: 'Videos' }
                ])}
                <label>Location</label>
                ${this._renderFilterBtns('gps', [
                  { value: 'exif', label: 'Exif', color: '#3b82f6' },
                  { value: 'inferred', label: 'Inferred', color: '#f59e0b' },
                  { value: 'user', label: 'User', color: '#22c55e' },
                  { value: 'none', label: 'None', color: '#9ca3af' }
                ])}
                <label>Map</label>
                ${renderStyleBtns(
                  [
                    { style: 'satellite', label: 'Aerial' },
                    { style: 'topo', label: 'Topo' },
                    { style: 'mml_maastokartta', label: 'Maasto' },
                    { style: 'mml_ortokuva', label: 'Orto' }
                  ],
                  this._mapStyle,
                  (s) => {
                    this._mapStyle = s;
                    mapStyleToUrl(s);
                    document.dispatchEvent(new ChangeMapStyleEvent(s));
                  }
                )}
                <label>Markers</label>
                ${renderStyleBtns(
                  [
                    { style: 'points', label: 'Points' },
                    { style: 'classic', label: 'Classic' }
                  ],
                  this._markerStyle,
                  (s) => {
                    this._markerStyle = s;
                    markerStyleToUrl(s);
                    document.dispatchEvent(new ChangeMarkerStyleEvent(s));
                  }
                )}
                <div class="view-buttons">
                  <button
                    class="view-btn"
                    @click=${() => {
                      document.dispatchEvent(new FitToPhotosEvent(true, true));
                    }}
                  >
                    Fit
                  </button>
                  <button
                    class="view-btn"
                    @click=${() => {
                      this._onReset();
                    }}
                  >
                    Reset
                  </button>
                  <button
                    class="view-btn ${this._measureActive ? 'active' : ''}"
                    @click=${() => {
                      this._measureActive = !this._measureActive;
                      document.dispatchEvent(new ToggleMeasureModeEvent());
                    }}
                  >
                    Measure
                  </button>
                </div>
                ${this._tracksAvailable
                  ? html` <div class="view-buttons">
                      <button
                        class="view-btn ${this._tracksVisible ? 'active' : ''}"
                        @click=${() => {
                          this._tracksVisible = !this._tracksVisible;
                          tracksVisibleToUrl(this._tracksVisible);
                          document.dispatchEvent(
                            new SetGpxVisibleEvent(this._tracksVisible)
                          );
                        }}
                      >
                        Tracks
                      </button>
                    </div>`
                  : nothing}
                <div class="view-buttons">
                  <button
                    class="view-btn"
                    @click=${() => {
                      document.dispatchEvent(new OpenExternalMapEvent('apple'));
                    }}
                  >
                    Apple Maps
                  </button>
                  <button
                    class="view-btn"
                    @click=${() => {
                      document.dispatchEvent(
                        new OpenExternalMapEvent('google')
                      );
                    }}
                  >
                    Google Maps
                  </button>
                </div>
                ${editCount > 0
                  ? html` <div class="edit-section">
                      <span class="count">${editCount}</span> pending edits
                      <div class="edit-buttons">
                        <button
                          ?disabled=${this._store.isSaving}
                          @click=${() => {
                            document.dispatchEvent(new SaveEditsEvent());
                          }}
                        >
                          ${this._store.isSaving ? 'Saving...' : 'Save to Photos'}
                        </button>
                        <button
                          class="secondary"
                          @click=${() => {
                            clearPendingEdits();
                          }}
                        >
                          Discard
                        </button>
                      </div>
                    </div>`
                  : nothing}
              </div>
            `}
      </div>
    `;
  }
}
