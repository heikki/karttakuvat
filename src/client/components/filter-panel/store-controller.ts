import type { ReactiveController, ReactiveControllerHost } from 'lit';

import { state, subscribe } from '@common/data';
import * as edits from '@common/edits';
import type { Photo } from '@common/types';

export class StoreController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeEdits: (() => void) | null = null;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected() {
    this.unsubscribe = subscribe(() => {
      this.host.requestUpdate();
    });
    this.unsubscribeEdits = edits.subscribe(() => {
      this.host.requestUpdate();
    });
  }

  hostDisconnected() {
    this.unsubscribe?.();
    this.unsubscribeEdits?.();
    this.unsubscribe = null;
    this.unsubscribeEdits = null;
  }

  /* eslint-disable @typescript-eslint/class-methods-use-this -- intentional proxies to module-level state */
  get photos(): Photo[] {
    return state.photos;
  }
  get filteredPhotos(): Photo[] {
    return state.filteredPhotos;
  }
  get editCount(): number {
    return edits.getCount();
  }
  get isSaving(): boolean {
    return edits.getIsSaving();
  }
  /* eslint-enable @typescript-eslint/class-methods-use-this */
}
