/**
 * API base URL management.
 *
 * Both dev server and Electrobun app serve everything from the same HTTP origin,
 * so the base URL is always '' (same-origin requests).
 */

let apiBase = '';

export const apiReady: Promise<void> = Promise.resolve();

export function getApiBase(): string {
  return apiBase;
}

export function setApiBase(base: string) {
  apiBase = base;
}
