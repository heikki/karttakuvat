import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { deleteAlbumFile, getAlbumFiles, setFileVisible } from './album-files';

let dataDir = '';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'karttakuvat-albumfiles-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('album-files', () => {
  test('getAlbumFiles returns empty map by default', () => {
    expect(getAlbumFiles(dataDir, 'Helsinki').size).toBe(0);
  });

  test('setFileVisible writes and toggles visibility', () => {
    setFileVisible(dataDir, 'Helsinki', 'route.gpx', true);
    expect(getAlbumFiles(dataDir, 'Helsinki').get('route.gpx')).toEqual({
      visible: true
    });
    setFileVisible(dataDir, 'Helsinki', 'route.gpx', false);
    expect(getAlbumFiles(dataDir, 'Helsinki').get('route.gpx')).toEqual({
      visible: false
    });
  });

  test('deleteAlbumFile removes a single entry', () => {
    setFileVisible(dataDir, 'Helsinki', 'a.gpx', true);
    setFileVisible(dataDir, 'Helsinki', 'b.gpx', true);
    deleteAlbumFile(dataDir, 'Helsinki', 'a.gpx');
    const map = getAlbumFiles(dataDir, 'Helsinki');
    expect(map.has('a.gpx')).toBe(false);
    expect(map.has('b.gpx')).toBe(true);
  });

  test('multiple albums isolated', () => {
    setFileVisible(dataDir, 'Helsinki', 'a.gpx', true);
    setFileVisible(dataDir, 'Lapland', 'b.gpx', false);
    expect(getAlbumFiles(dataDir, 'Helsinki').get('a.gpx')).toEqual({
      visible: true
    });
    expect(getAlbumFiles(dataDir, 'Lapland').get('b.gpx')).toEqual({
      visible: false
    });
    expect(getAlbumFiles(dataDir, 'Helsinki').has('b.gpx')).toBe(false);
  });
});
