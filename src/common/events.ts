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

export class AdjustTimeEvent extends Event {
  static readonly type = 'adjust-time';
  readonly hours: number;
  constructor(hours: number) {
    super(AdjustTimeEvent.type, opts);
    this.hours = hours;
  }
}

export class CopyLocationEvent extends Event {
  static readonly type = 'copy-location';
  constructor() {
    super(CopyLocationEvent.type, opts);
  }
}

export class PasteLocationEvent extends Event {
  static readonly type = 'paste-location';
  constructor() {
    super(PasteLocationEvent.type, opts);
  }
}

export class CopyDateEvent extends Event {
  static readonly type = 'copy-date';
  constructor() {
    super(CopyDateEvent.type, opts);
  }
}

export class PasteDateEvent extends Event {
  static readonly type = 'paste-date';
  constructor() {
    super(PasteDateEvent.type, opts);
  }
}

export class ToggleDateEditEvent extends Event {
  static readonly type = 'toggle-date-edit';
  constructor() {
    super(ToggleDateEditEvent.type, opts);
  }
}

export class ApplyManualDateEvent extends Event {
  static readonly type = 'apply-manual-date';
  readonly dateValue: string;
  constructor(dateValue: string) {
    super(ApplyManualDateEvent.type, opts);
    this.dateValue = dateValue;
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

export class SetGpxVisibleEvent extends Event {
  static readonly type = 'set-gpx-visible';
  readonly visible: boolean;
  constructor(visible: boolean) {
    super(SetGpxVisibleEvent.type);
    this.visible = visible;
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
  constructor(target: 'apple' | 'google') {
    super(OpenExternalMapEvent.type);
    this.provider = target;
  }
}

/* ── Map status events (map → filter-panel) ── */

export class GpxDataChangedEvent extends Event {
  static readonly type = 'gpx-data-changed';
  readonly available: boolean;
  constructor(available: boolean) {
    super(GpxDataChangedEvent.type);
    this.available = available;
  }
}

export class MeasureModeExitedEvent extends Event {
  static readonly type = 'measure-mode-exited';
  constructor() {
    super(MeasureModeExitedEvent.type);
  }
}

declare global {
  interface HTMLElementEventMap {
    [ShowLightboxEvent.type]: ShowLightboxEvent;
    [EnterPlacementEvent.type]: EnterPlacementEvent;
    [AdjustTimeEvent.type]: AdjustTimeEvent;
    [CopyLocationEvent.type]: CopyLocationEvent;
    [PasteLocationEvent.type]: PasteLocationEvent;
    [CopyDateEvent.type]: CopyDateEvent;
    [PasteDateEvent.type]: PasteDateEvent;
    [ToggleDateEditEvent.type]: ToggleDateEditEvent;
    [ApplyManualDateEvent.type]: ApplyManualDateEvent;
    [ShowMetadataEvent.type]: ShowMetadataEvent;
  }
  interface DocumentEventMap {
    [ChangeMapStyleEvent.type]: ChangeMapStyleEvent;
    [ChangeMarkerStyleEvent.type]: ChangeMarkerStyleEvent;
    [FitToPhotosEvent.type]: FitToPhotosEvent;
    [ResetMapEvent.type]: ResetMapEvent;
    [SetGpxVisibleEvent.type]: SetGpxVisibleEvent;
    [ToggleMeasureModeEvent.type]: ToggleMeasureModeEvent;
    [OpenExternalMapEvent.type]: OpenExternalMapEvent;
    [SaveEditsEvent.type]: SaveEditsEvent;
    [GpxDataChangedEvent.type]: GpxDataChangedEvent;
    [MeasureModeExitedEvent.type]: MeasureModeExitedEvent;
  }
}
