import {
  copyDate,
  copyLocation,
  getCopiedDate,
  getCopiedLocation
} from '@common/clipboard';
import * as edits from '@common/edits';
import { SaveEditsEvent } from '@common/events';
import {
  computeDateOffsetHours,
  computeFullDatetimeOffsetHours,
  parseExifDate,
  parseUserDatetime
} from '@common/utils';

import * as selection from '../selection';

function computeManualDateOffset(
  originalDate: string,
  parsed: { day: string; time: string | null }
): number | null {
  if (parsed.time === null) {
    return computeDateOffsetHours(originalDate, parsed.day);
  }
  const timeParts = parsed.time.split(':').map(Number);
  const dayParts = parsed.day.split(':');
  const target = new Date(
    parseInt(dayParts[0]!, 10),
    parseInt(dayParts[1]!, 10) - 1,
    parseInt(dayParts[2]!, 10),
    timeParts[0] ?? 0,
    timeParts[1] ?? 0,
    timeParts[2] ?? 0
  );
  return computeFullDatetimeOffsetHours(originalDate, target);
}

let dateEditMode = false;

type Listener = () => void;
const listeners: Listener[] = [];

function notify(): void {
  for (const fn of [...listeners]) fn();
}

export function subscribe(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i > -1) listeners.splice(i, 1);
  };
}

export function getDateEditMode(): boolean {
  return dateEditMode;
}

let lastUuid: string | null = null;

// Auto-reset date edit mode when the popup closes or moves to a different
// photo. Must be called before popup/index.ts subscribes to selection so this
// reset runs first and the Lit re-sync sees the fresh value.
export function initPopupEdits(): void {
  selection.subscribe(() => {
    const uuid = selection.getPhotoUuid();
    const mode = selection.getMode();
    if (dateEditMode && (mode !== 'popup' || uuid !== lastUuid)) {
      dateEditMode = false;
      notify();
    }
    lastUuid = uuid;
  });
}

export function confirmCurrentLocation(): void {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const loc = edits.getEffectiveLocation(photo);
  if (loc === null) return;
  edits.setCoord(photo.uuid, loc.lat, loc.lon);
  document.dispatchEvent(new SaveEditsEvent());
}

export function copyCurrentLocation(): void {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const loc = edits.getEffectiveLocation(photo);
  if (loc === null) return;
  copyLocation(loc.lat, loc.lon);
}

export function pasteCurrentLocation(): void {
  const photo = selection.getPhoto();
  const copied = getCopiedLocation();
  if (photo === undefined || copied === null) return;
  edits.setCoord(photo.uuid, copied.lat, copied.lon);
}

export function copyCurrentDate(): void {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const effectiveDate = edits.getEffectiveDate(photo);
  if (effectiveDate === '') return;
  copyDate(effectiveDate);
}

export function pasteCurrentDate(): void {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  const copied = getCopiedDate();
  if (copied === null) return;
  const copiedDate = parseExifDate(copied);
  if (copiedDate === null) return;
  const offset = computeFullDatetimeOffsetHours(photo.date, copiedDate);
  if (offset === null) return;
  edits.setTimeOffset(photo.uuid, offset);
}

export function adjustCurrentTime(hours: number): void {
  const uuid = selection.getPhotoUuid();
  if (uuid === null) return;
  edits.addTimeOffset(uuid, hours);
}

export function toggleDateEdit(): void {
  dateEditMode = !dateEditMode;
  notify();
}

export function applyManualDateToCurrent(value: string): void {
  const photo = selection.getPhoto();
  if (photo === undefined) return;
  if (value.trim() === '') return;
  const yearStr = photo.date.split(':')[0];
  const fallbackYear =
    yearStr !== undefined && yearStr !== ''
      ? parseInt(yearStr, 10)
      : new Date().getFullYear();
  const parsed = parseUserDatetime(value, fallbackYear);
  if (parsed === null) return;
  const offset = computeManualDateOffset(photo.date, parsed);
  if (offset === null) return;
  // Set before edit so the implicit sync triggered by setTimeOffset's notify
  // reads dateEditMode = false.
  dateEditMode = false;
  edits.setTimeOffset(photo.uuid, offset);
}
