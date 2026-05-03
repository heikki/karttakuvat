import type { Photo } from '@common/types';
import { exifDatePattern } from '@common/utils';

const pendingCoords = new Map<string, { lat: number; lon: number }>();
const pendingTimeOffsets = new Map<string, number>();
let saving = false;

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

export function setCoord(uuid: string, lat: number, lon: number): void {
  pendingCoords.set(uuid, { lat, lon });
  notify();
}

export function getEffectiveCoords(photo: Photo): {
  lat: number;
  lon: number;
} {
  const pending = pendingCoords.get(photo.uuid);
  if (pending !== undefined) return pending;
  return { lat: photo.lat ?? 0, lon: photo.lon ?? 0 };
}

export function getEffectiveLocation(
  photo: Photo
): { lat: number; lon: number } | null {
  if (
    photo.lat === null &&
    photo.lon === null &&
    !pendingCoords.has(photo.uuid)
  ) {
    return null;
  }
  return getEffectiveCoords(photo);
}

export function addTimeOffset(uuid: string, deltaHours: number): void {
  const current = pendingTimeOffsets.get(uuid) ?? 0;
  const total = current + deltaHours;
  if (total === 0) {
    pendingTimeOffsets.delete(uuid);
  } else {
    pendingTimeOffsets.set(uuid, total);
  }
  notify();
}

export function setTimeOffset(uuid: string, totalHours: number): void {
  if (totalHours === 0) {
    pendingTimeOffsets.delete(uuid);
  } else {
    pendingTimeOffsets.set(uuid, totalHours);
  }
  notify();
}

function applyHourOffset(dateStr: string, hours: number): string {
  if (dateStr === '' || hours === 0) return dateStr;
  const match = exifDatePattern.exec(dateStr);
  if (match?.groups === undefined) return dateStr;
  const { yr, mo, dy, hr, mi, sc } = match.groups;
  const d = new Date(
    parseInt(yr!, 10),
    parseInt(mo!, 10) - 1,
    parseInt(dy!, 10),
    parseInt(hr!, 10),
    parseInt(mi!, 10),
    parseInt(sc!, 10)
  );
  d.setTime(d.getTime() + Math.round(hours * 3600000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function getEffectiveDate(photo: Photo): string {
  const offset = pendingTimeOffsets.get(photo.uuid) ?? 0;
  if (offset === 0) return photo.date;
  return applyHourOffset(photo.date, offset);
}

export function getCoordEdits(): Array<{
  uuid: string;
  lat: number;
  lon: number;
}> {
  return Array.from(pendingCoords.entries()).map(([uuid, c]) => ({
    uuid,
    ...c
  }));
}

export function getTimeEdits(): Array<{ uuid: string; hours: number }> {
  return Array.from(pendingTimeOffsets.entries()).map(([uuid, hours]) => ({
    uuid,
    hours
  }));
}

export function getCount(): number {
  return pendingCoords.size + pendingTimeOffsets.size;
}

export function clear(): void {
  pendingCoords.clear();
  pendingTimeOffsets.clear();
  notify();
}

export function getIsSaving(): boolean {
  return saving;
}

export function setSaving(s: boolean): void {
  saving = s;
  notify();
}
