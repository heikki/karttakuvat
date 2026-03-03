import { html, LitElement, nothing } from 'lit';
import { customElement, state as litState } from 'lit/decorators.js';

import { applyFilters, clearPendingEdits } from '@common/data';
import {
  ChangeMapStyleEvent,
  ChangeMarkerStyleEvent,
  FitToPhotosEvent,
  MeasureModeExitedEvent,
  OpenExternalMapEvent,
  ResetMapEvent,
  RouteEditExitedEvent,
  SaveEditsEvent,
  ShowAlbumFilesEvent,
  ToggleMeasureModeEvent,
  TogglePhotoRouteEvent,
  ToggleRouteEditEvent
} from '@common/events';
import {
  filtersFromUrl,
  filtersToUrl,
  mapStyleFromUrl,
  mapStyleToUrl,
  markerStyleFromUrl,
  markerStyleToUrl,
  routeFromUrl,
  routeToUrl
} from '@common/filter-url';
import { getYear, isVideo } from '@common/utils';

import {
  DEFAULT_GPS,
  DEFAULT_MEDIA,
  renderFilterBtns,
  renderSelect,
  renderStyleBtns
} from './helpers';
import { StoreController } from './store-controller';
import { styles } from './styles';

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
  @litState() private _routeActive = false;
  @litState() private _routeEditActive = false;

  private _initialized = false;
  private _gpsClickTimer: ReturnType<typeof setTimeout> | null = null;
  private _mediaClickTimer: ReturnType<typeof setTimeout> | null = null;

  static override styles = styles;

  override connectedCallback() {
    super.connectedCallback();
    this._restoreFromUrl();
    document.addEventListener(
      MeasureModeExitedEvent.type,
      this._onMeasureExited
    );
    document.addEventListener(
      RouteEditExitedEvent.type,
      this._onRouteEditExited
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
      MeasureModeExitedEvent.type,
      this._onMeasureExited
    );
    document.removeEventListener(
      RouteEditExitedEvent.type,
      this._onRouteEditExited
    );
  }

  private readonly _onMeasureExited = () => {
    this._measureActive = false;
  };
  private readonly _onRouteEditExited = () => {
    this._routeEditActive = false;
  };

  private _exitRouteEdit() {
    if (this._routeEditActive) {
      this._routeEditActive = false;
      document.dispatchEvent(new ToggleRouteEditEvent());
    }
  }

  private _restoreFromUrl() {
    const saved = filtersFromUrl();
    if (saved !== null) {
      if (saved.year !== undefined) this._year = saved.year;
      if (saved.album !== undefined) this._album = saved.album;
      if (saved.camera !== undefined) this._camera = saved.camera;
      if (saved.gps !== undefined) this._gps = saved.gps;
      if (saved.media !== undefined) this._media = saved.media;
    }
    this._routeActive = routeFromUrl();
    const mapStyle = mapStyleFromUrl();
    if (mapStyle !== null) this._mapStyle = mapStyle;
    const markerStyle = markerStyleFromUrl();
    if (markerStyle !== null) this._markerStyle = markerStyle;
  }

  private _applyInitialFilters() {
    const albumOpts = this._getAlbumOptions();
    if (this._album !== 'all' && !albumOpts.includes(this._album)) {
      this._album = 'all';
    }
    const cameraOpts = this._getCameraOptions();
    if (this._camera !== 'all' && !cameraOpts.includes(this._camera)) {
      this._camera = 'all';
    }
    this._applyFilters();
    document.dispatchEvent(new ChangeMapStyleEvent(this._mapStyle));
    document.dispatchEvent(new ChangeMarkerStyleEvent(this._markerStyle));
    if (this._routeActive) {
      document.dispatchEvent(new TogglePhotoRouteEvent(true));
    }
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
    if (this._album !== 'all' && !albumOpts.includes(this._album)) {
      this._album = 'all';
    }
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
    if (this._album === 'all' && this._routeActive) {
      this._exitRouteEdit();
      this._routeActive = false;
      routeToUrl(false);
      document.dispatchEvent(new TogglePhotoRouteEvent(false));
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
    this._exitRouteEdit();
    if (this._routeActive) {
      this._routeActive = false;
      document.dispatchEvent(new TogglePhotoRouteEvent(false));
    }
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
                ${renderFilterBtns(
                  this._media,
                  [
                    { value: 'photo', label: 'Photos' },
                    { value: 'video', label: 'Videos' }
                  ],
                  (v) => {
                    this._onMediaClick(v);
                  },
                  (v) => {
                    this._onMediaDblClick(v);
                  }
                )}
                <label>Location</label>
                ${renderFilterBtns(
                  this._gps,
                  [
                    { value: 'exif', label: 'Exif', color: '#3b82f6' },
                    { value: 'inferred', label: 'Inferred', color: '#f59e0b' },
                    { value: 'user', label: 'User', color: '#22c55e' },
                    { value: 'none', label: 'None', color: '#9ca3af' }
                  ],
                  (v) => {
                    this._onGpsClick(v);
                  },
                  (v) => {
                    this._onGpsDblClick(v);
                  }
                )}
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
                    { style: 'classic', label: 'Classic' },
                    { style: 'points', label: 'Points' }
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
                ${this._album === 'all'
                  ? nothing
                  : html` <div class="view-buttons">
                      <button
                        class="view-btn"
                        @click=${() => {
                          document.dispatchEvent(
                            new ShowAlbumFilesEvent(this._album)
                          );
                        }}
                      >
                        Files
                      </button>
                      <button
                        class="view-btn ${this._routeActive ? 'active' : ''}"
                        @click=${() => {
                          if (this._routeActive) this._exitRouteEdit();
                          this._routeActive = !this._routeActive;
                          routeToUrl(this._routeActive);
                          document.dispatchEvent(
                            new TogglePhotoRouteEvent(this._routeActive)
                          );
                        }}
                      >
                        Route
                      </button>
                      ${this._routeActive
                        ? html`<button
                            class="view-btn ${this._routeEditActive
                              ? 'active'
                              : ''}"
                            @click=${() => {
                              this._routeEditActive = !this._routeEditActive;
                              document.dispatchEvent(
                                new ToggleRouteEditEvent()
                              );
                            }}
                          >
                            Edit
                          </button>`
                        : nothing}
                    </div>`}
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
                          ${this._store.isSaving
                            ? 'Saving...'
                            : 'Save to Photos'}
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
