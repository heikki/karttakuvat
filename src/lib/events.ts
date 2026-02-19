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

export class NavigatePhotoEvent extends Event {
  static readonly type = 'navigate-photo';
  readonly direction: 'prev' | 'next';
  constructor(direction: 'prev' | 'next') {
    super(NavigatePhotoEvent.type, opts);
    this.direction = direction;
  }
}

export class CloseLightboxEvent extends Event {
  static readonly type = 'close-lightbox';
  constructor() {
    super(CloseLightboxEvent.type, opts);
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
    [NavigatePhotoEvent.type]: NavigatePhotoEvent;
    [CloseLightboxEvent.type]: CloseLightboxEvent;
  }
}
