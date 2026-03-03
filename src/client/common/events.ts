import type { Photo } from './types';

const opts = { bubbles: true, composed: true };

export class ShowLightboxEvent extends Event {
  static readonly type = 'show-lightbox';
  readonly index: number;
  constructor(index: number) {
    super(ShowLightboxEvent.type, opts);
    this.index = index;
  }
}

export class EnterPlacementEvent extends Event {
  static readonly type = 'enter-placement';
  readonly photo: Photo;
  readonly index: number;
  constructor(photo: Photo, index: number) {
    super(EnterPlacementEvent.type, opts);
    this.photo = photo;
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

export class TogglePhotoRouteEvent extends Event {
  static readonly type = 'toggle-photo-route';
  readonly show: boolean;
  constructor(show: boolean) {
    super(TogglePhotoRouteEvent.type);
    this.show = show;
  }
}

/* ── Map status events (map → filter-panel) ── */

export class MeasureModeExitedEvent extends Event {
  static readonly type = 'measure-mode-exited';
  constructor() {
    super(MeasureModeExitedEvent.type);
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

declare global {
  interface HTMLElementEventMap {
    [ShowLightboxEvent.type]: ShowLightboxEvent;
    [EnterPlacementEvent.type]: EnterPlacementEvent;
    [ShowMetadataEvent.type]: ShowMetadataEvent;
  }
  interface DocumentEventMap {
    [ShowLightboxEvent.type]: ShowLightboxEvent;
    [EnterPlacementEvent.type]: EnterPlacementEvent;
    [ShowMetadataEvent.type]: ShowMetadataEvent;
    [ChangeMapStyleEvent.type]: ChangeMapStyleEvent;
    [ChangeMarkerStyleEvent.type]: ChangeMarkerStyleEvent;
    [FitToPhotosEvent.type]: FitToPhotosEvent;
    [ResetMapEvent.type]: ResetMapEvent;
    [ToggleMeasureModeEvent.type]: ToggleMeasureModeEvent;
    [OpenExternalMapEvent.type]: OpenExternalMapEvent;
    [SaveEditsEvent.type]: SaveEditsEvent;
    [TogglePhotoRouteEvent.type]: TogglePhotoRouteEvent;
    [MeasureModeExitedEvent.type]: MeasureModeExitedEvent;
    [ShowAlbumFilesEvent.type]: ShowAlbumFilesEvent;
  }
}
