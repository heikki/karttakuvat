import type { ReactiveController, ReactiveControllerHost } from 'lit';

import { state, subscribe, subscribeEdits } from '@common/data';
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
    this.unsubscribeEdits = subscribeEdits(() => {
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
  get photos(): Photo[] { return state.photos; }
  get filteredPhotos(): Photo[] { return state.filteredPhotos; }
  get filters() { return state.filters; }
  get editCount(): number { return state.pendingEdits.size + state.pendingTimeEdits.size; }
  /* eslint-enable @typescript-eslint/class-methods-use-this */
}
