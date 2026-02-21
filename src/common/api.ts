/**
 * API base URL management for Electrobun app support.
 *
 * In dev mode (regular browser), apiReady resolves immediately and getApiBase()
 * returns '' (same-origin requests). In Electrobun mode (views:// protocol),
 * apiReady waits until setApiBase() is called via RPC with the local server URL.
 */

let apiBase = '';

const isElectrobun =
  typeof location !== 'undefined' && location.protocol === 'views:';

// eslint-disable-next-line @typescript-eslint/no-empty-function -- resolved later by setApiBase
let _resolve: () => void = () => {};

export const apiReady: Promise<void> = isElectrobun
  ? // eslint-disable-next-line promise/avoid-new, promise/param-names -- deferred resolve pattern
    new Promise<void>((r) => {
      _resolve = r;
    })
  : Promise.resolve();

export function getApiBase(): string {
  return apiBase;
}

export function setApiBase(base: string) {
  apiBase = base;
  _resolve();
}
