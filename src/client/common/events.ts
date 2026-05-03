const opts = { bubbles: true, composed: true };

export class ShowLightboxEvent extends Event {
  static readonly type = 'show-lightbox';
  readonly index: number;
  constructor(index: number) {
    super(ShowLightboxEvent.type, opts);
    this.index = index;
  }
}

// Bare request signal: dispatched by <photo-popup>'s "set" button.
// Carries no payload — the selection module knows the current photo.
export class PlacementModeEvent extends Event {
  static readonly type = 'placement-mode';
  constructor() {
    super(PlacementModeEvent.type, opts);
  }
}

export class ShowMetadataEvent extends Event {
  static readonly type = 'show-metadata';
  readonly uuid: string;
  constructor(uuid: string) {
    super(ShowMetadataEvent.type, opts);
    this.uuid = uuid;
  }
}

/* ── Map command events (filter-panel → map) ── */

export class ChangeMapStyleEvent extends Event {
  static readonly type = 'change-map-style';
  readonly style: string;
  constructor(style: string) {
    super(ChangeMapStyleEvent.type);
    this.style = style;
  }
}

export class ChangeMarkerStyleEvent extends Event {
  static readonly type = 'change-marker-style';
  readonly style: string;
  constructor(style: string) {
    super(ChangeMarkerStyleEvent.type);
    this.style = style;
  }
}

export class FitToPhotosEvent extends Event {
  static readonly type = 'fit-to-photos';
  readonly animate: boolean;
  readonly selectFirst: boolean;
  constructor(animate = false, selectFirst = false) {
    super(FitToPhotosEvent.type);
    this.animate = animate;
    this.selectFirst = selectFirst;
  }
}

export class ResetMapEvent extends Event {
  static readonly type = 'reset-map';
  constructor() {
    super(ResetMapEvent.type);
  }
}

export class ToggleMeasureModeEvent extends Event {
  static readonly type = 'toggle-measure-mode';
  constructor() {
    super(ToggleMeasureModeEvent.type);
  }
}

export class SaveEditsEvent extends Event {
  static readonly type = 'save-edits';
  constructor() {
    super(SaveEditsEvent.type);
  }
}

export class OpenExternalMapEvent extends Event {
  static readonly type = 'open-external-map';
  readonly provider: 'apple' | 'google';
  constructor(provider: 'apple' | 'google') {
    super(OpenExternalMapEvent.type);
    this.provider = provider;
  }
}

export class RouteVisibilityEvent extends Event {
  static readonly type = 'route-visibility';
  readonly visible: boolean;
  constructor(visible: boolean) {
    super(RouteVisibilityEvent.type);
    this.visible = visible;
  }
}

export class ToggleRouteEditEvent extends Event {
  static readonly type = 'toggle-route-edit';
  constructor() {
    super(ToggleRouteEditEvent.type);
  }
}

/* ── Map status events (map → filter-panel) ── */

export class MeasureModeExitedEvent extends Event {
  static readonly type = 'measure-mode-exited';
  constructor() {
    super(MeasureModeExitedEvent.type);
  }
}

export class RouteEditModeEvent extends Event {
  static readonly type = 'route-edit-mode';
  readonly active: boolean;
  constructor(active: boolean) {
    super(RouteEditModeEvent.type);
    this.active = active;
  }
}

export class ShowAlbumFilesEvent extends Event {
  static readonly type = 'show-album-files';
  readonly album: string;
  constructor(album: string) {
    super(ShowAlbumFilesEvent.type);
    this.album = album;
  }
}

export class AlbumFilesChangedEvent extends Event {
  static readonly type = 'album-files-changed';
  constructor() {
    super(AlbumFilesChangedEvent.type);
  }
}

declare global {
  interface HTMLElementEventMap {
    [ShowLightboxEvent.type]: ShowLightboxEvent;
    [PlacementModeEvent.type]: PlacementModeEvent;
    [ShowMetadataEvent.type]: ShowMetadataEvent;
  }
  interface DocumentEventMap {
    [ShowLightboxEvent.type]: ShowLightboxEvent;
    [PlacementModeEvent.type]: PlacementModeEvent;
    [ShowMetadataEvent.type]: ShowMetadataEvent;
    [ChangeMapStyleEvent.type]: ChangeMapStyleEvent;
    [ChangeMarkerStyleEvent.type]: ChangeMarkerStyleEvent;
    [FitToPhotosEvent.type]: FitToPhotosEvent;
    [ResetMapEvent.type]: ResetMapEvent;
    [ToggleMeasureModeEvent.type]: ToggleMeasureModeEvent;
    [OpenExternalMapEvent.type]: OpenExternalMapEvent;
    [SaveEditsEvent.type]: SaveEditsEvent;
    [RouteVisibilityEvent.type]: RouteVisibilityEvent;
    [ToggleRouteEditEvent.type]: ToggleRouteEditEvent;
    [MeasureModeExitedEvent.type]: MeasureModeExitedEvent;
    [RouteEditModeEvent.type]: RouteEditModeEvent;
    [ShowAlbumFilesEvent.type]: ShowAlbumFilesEvent;
    [AlbumFilesChangedEvent.type]: AlbumFilesChangedEvent;
  }
}
