const opts = { bubbles: true, composed: true };

export class ShowLightboxEvent extends Event {
  static readonly type = 'show-lightbox';
  readonly index: number;
  constructor(index: number) {
    super(ShowLightboxEvent.type, opts);
    this.index = index;
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

// Bare request signal: dispatched by <photo-popup>'s "set" button.
// Carries no payload — the selection module knows the current photo.
export class EnterPlacementModeEvent extends Event {
  static readonly type = 'enter-placement-mode';
  constructor() {
    super(EnterPlacementModeEvent.type, opts);
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

export class OpenExternalMapEvent extends Event {
  static readonly type = 'open-external-map';
  readonly provider: 'apple' | 'google';
  constructor(provider: 'apple' | 'google') {
    super(OpenExternalMapEvent.type);
    this.provider = provider;
  }
}

export class ToggleMeasureModeEvent extends Event {
  static readonly type = 'toggle-measure-mode';
  constructor() {
    super(ToggleMeasureModeEvent.type);
  }
}

export class MeasureModeExitedEvent extends Event {
  static readonly type = 'measure-mode-exited';
  constructor() {
    super(MeasureModeExitedEvent.type);
  }
}

export class SetRouteVisibilityEvent extends Event {
  static readonly type = 'set-route-visibility';
  readonly visible: boolean;
  constructor(visible: boolean) {
    super(SetRouteVisibilityEvent.type);
    this.visible = visible;
  }
}

export class ToggleRouteEditEvent extends Event {
  static readonly type = 'toggle-route-edit';
  constructor() {
    super(ToggleRouteEditEvent.type);
  }
}

export class RouteEditModeChangedEvent extends Event {
  static readonly type = 'route-edit-mode-changed';
  readonly active: boolean;
  constructor(active: boolean) {
    super(RouteEditModeChangedEvent.type);
    this.active = active;
  }
}

export class SaveEditsEvent extends Event {
  static readonly type = 'save-edits';
  constructor() {
    super(SaveEditsEvent.type);
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
    [ShowMetadataEvent.type]: ShowMetadataEvent;
    [EnterPlacementModeEvent.type]: EnterPlacementModeEvent;
  }
  interface DocumentEventMap {
    [ShowLightboxEvent.type]: ShowLightboxEvent;
    [ShowMetadataEvent.type]: ShowMetadataEvent;
    [EnterPlacementModeEvent.type]: EnterPlacementModeEvent;
    [ChangeMarkerStyleEvent.type]: ChangeMarkerStyleEvent;
    [FitToPhotosEvent.type]: FitToPhotosEvent;
    [ResetMapEvent.type]: ResetMapEvent;
    [OpenExternalMapEvent.type]: OpenExternalMapEvent;
    [ToggleMeasureModeEvent.type]: ToggleMeasureModeEvent;
    [MeasureModeExitedEvent.type]: MeasureModeExitedEvent;
    [SetRouteVisibilityEvent.type]: SetRouteVisibilityEvent;
    [ToggleRouteEditEvent.type]: ToggleRouteEditEvent;
    [RouteEditModeChangedEvent.type]: RouteEditModeChangedEvent;
    [SaveEditsEvent.type]: SaveEditsEvent;
    [ShowAlbumFilesEvent.type]: ShowAlbumFilesEvent;
    [AlbumFilesChangedEvent.type]: AlbumFilesChangedEvent;
  }
}
