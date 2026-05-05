import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  deleteAlbumFile,
  deleteItems,
  getAlbumFiles,
  getAllItems,
  getItemCount,
  getSetting,
  openAppDb,
  setFileVisible,
  setSetting,
  updateItemDate,
  updateItemLocation,
  upsertItems
} from './app-db';
import type { ItemEntry } from './items';

let dataDir = '';

const sampleItem = (overrides: Partial<ItemEntry> = {}): ItemEntry => ({
  uuid: overrides.uuid ?? 'uuid-1',
  type: 'photo',
  full: 'full/uuid-1.jpg',
  thumb: 'thumb/uuid-1.jpg',
  lat: 60.17,
  lon: 24.94,
  date: '2024-06-01T12:00:00',
  tz: '+03:00',
  camera: 'iPhone 15',
  gps: 'exif',
  gps_accuracy: 5,
  albums: ['Helsinki'],
  photos_url: 'photos:albums?albumUuid=A&assetUuid=uuid-1',
  ...overrides
});

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'karttakuvat-appdb-'));
  openAppDb(dataDir);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('app-db settings', () => {
  test('getSetting returns null for missing keys', () => {
    expect(getSetting('missing')).toBe(null);
  });

  test('setSetting then getSetting round-trips', () => {
    setSetting('view', '{"zoom":7}');
    expect(getSetting('view')).toBe('{"zoom":7}');
  });

  test('setSetting overwrites existing values', () => {
    setSetting('window', 'a');
    setSetting('window', 'b');
    expect(getSetting('window')).toBe('b');
  });
});

describe('app-db items', () => {
  test('getItemCount is zero on a fresh db', () => {
    expect(getItemCount()).toBe(0);
    expect(getAllItems()).toEqual([]);
  });

  test('upsertItems inserts and getAllItems returns them sorted by date', () => {
    upsertItems([
      sampleItem({ uuid: 'b', date: '2024-07-01T00:00:00' }),
      sampleItem({ uuid: 'a', date: '2024-06-01T00:00:00' })
    ]);
    expect(getItemCount()).toBe(2);
    const all = getAllItems();
    expect(all.map((i) => i.uuid)).toEqual(['a', 'b']);
  });

  test('upsertItems replaces an existing row by uuid', () => {
    upsertItems([sampleItem({ uuid: 'x', camera: 'old' })]);
    upsertItems([sampleItem({ uuid: 'x', camera: 'new' })]);
    expect(getItemCount()).toBe(1);
    expect(getAllItems()[0]?.camera).toBe('new');
  });

  test('updateItemLocation writes lat/lon/gps/tz/date', () => {
    upsertItems([sampleItem({ uuid: 'x', lat: null, lon: null })]);
    updateItemLocation({
      uuid: 'x',
      lat: 1.5,
      lon: 2.5,
      gps: 'user',
      gpsAccuracy: 10,
      tz: '+02:00',
      date: '2024-08-01T00:00:00'
    });
    const item = getAllItems()[0];
    expect(item?.lat).toBe(1.5);
    expect(item?.lon).toBe(2.5);
    expect(item?.gps).toBe('user');
    expect(item?.tz).toBe('+02:00');
    expect(item?.date).toBe('2024-08-01T00:00:00');
  });

  test('updateItemDate updates only the date', () => {
    upsertItems([sampleItem({ uuid: 'x', date: '2024-01-01T00:00:00' })]);
    updateItemDate('x', '2024-02-02T00:00:00');
    expect(getAllItems()[0]?.date).toBe('2024-02-02T00:00:00');
  });

  test('deleteItems removes rows by uuid', () => {
    upsertItems([
      sampleItem({ uuid: 'a' }),
      sampleItem({ uuid: 'b' }),
      sampleItem({ uuid: 'c' })
    ]);
    deleteItems(['a', 'c']);
    expect(getAllItems().map((i) => i.uuid)).toEqual(['b']);
  });
});

describe('app-db album files', () => {
  test('getAlbumFiles returns empty map by default', () => {
    expect(getAlbumFiles('Helsinki').size).toBe(0);
  });

  test('setFileVisible writes and toggles visibility', () => {
    setFileVisible('Helsinki', 'route.gpx', true);
    expect(getAlbumFiles('Helsinki').get('route.gpx')).toEqual({
      visible: true
    });
    setFileVisible('Helsinki', 'route.gpx', false);
    expect(getAlbumFiles('Helsinki').get('route.gpx')).toEqual({
      visible: false
    });
  });

  test('deleteAlbumFile removes a single entry', () => {
    setFileVisible('Helsinki', 'a.gpx', true);
    setFileVisible('Helsinki', 'b.gpx', true);
    deleteAlbumFile('Helsinki', 'a.gpx');
    const map = getAlbumFiles('Helsinki');
    expect(map.has('a.gpx')).toBe(false);
    expect(map.has('b.gpx')).toBe(true);
  });
});
