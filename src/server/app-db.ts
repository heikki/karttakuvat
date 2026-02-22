import { Database } from 'bun:sqlite';

import type { ItemEntry } from './items';

let db: Database | null = null;

export function openAppDb(dataDir: string): void {
  db = new Database(`${dataDir}/app.db`);
  db.run('PRAGMA journal_mode = WAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS album_files (
      album TEXT NOT NULL,
      filename TEXT NOT NULL,
      visible INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (album, filename)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      uuid TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      lat REAL,
      lon REAL,
      date TEXT NOT NULL DEFAULT '',
      tz TEXT,
      camera TEXT,
      duration TEXT,
      gps TEXT,
      gps_accuracy REAL,
      albums TEXT NOT NULL DEFAULT '[]',
      photos_url TEXT NOT NULL DEFAULT ''
    )
  `);
}

// ---------------------------------------------------------------------------
// Items CRUD
// ---------------------------------------------------------------------------

interface ItemRow {
  uuid: string;
  type: string;
  lat: number | null;
  lon: number | null;
  date: string;
  tz: string | null;
  camera: string | null;
  duration: string | null;
  gps: string | null;
  gps_accuracy: number | null;
  albums: string;
  photos_url: string;
}

function rowToEntry(row: ItemRow): ItemEntry {
  return {
    uuid: row.uuid,
    type: row.type as 'photo' | 'video',
    full: `full/${row.uuid}.jpg`,
    thumb: `thumb/${row.uuid}.jpg`,
    lat: row.lat,
    lon: row.lon,
    date: row.date,
    tz: row.tz,
    camera: row.camera,
    ...(row.duration !== null ? { duration: row.duration } : {}),
    gps: row.gps as ItemEntry['gps'],
    gps_accuracy: row.gps_accuracy,
    albums: JSON.parse(row.albums) as string[],
    photos_url: row.photos_url
  };
}

export function getAllItems(): ItemEntry[] {
  if (db === null) return [];
  const rows = db
    .query<ItemRow, []>('SELECT * FROM items ORDER BY date, uuid')
    .all();
  return rows.map(rowToEntry);
}

export function getItem(uuid: string): ItemEntry | null {
  if (db === null) return null;
  const row = db
    .query<ItemRow, [string]>('SELECT * FROM items WHERE uuid = ?')
    .get(uuid);
  return row === null ? null : rowToEntry(row);
}

export function getItemCount(): number {
  if (db === null) return 0;
  const row = db
    .query<{ cnt: number }, []>('SELECT count(*) as cnt FROM items')
    .get();
  return row?.cnt ?? 0;
}

export function upsertItems(entries: ItemEntry[]): void {
  if (db === null || entries.length === 0) return;
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO items (uuid, type, lat, lon, date, tz, camera, duration, gps, gps_accuracy, albums, photos_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    for (const e of entries) {
      stmt.run(
        e.uuid,
        e.type,
        e.lat,
        e.lon,
        e.date,
        e.tz,
        e.camera,
        e.duration ?? null,
        e.gps,
        e.gps_accuracy,
        JSON.stringify(e.albums),
        e.photos_url
      );
    }
  });
  tx();
}

export function deleteItems(uuids: string[]): void {
  if (db === null || uuids.length === 0) return;
  const placeholders = uuids.map(() => '?').join(',');
  db.run(`DELETE FROM items WHERE uuid IN (${placeholders})`, uuids);
}

export function updateItemLocation(
  uuid: string,
  lat: number,
  lon: number,
  gps: string,
  gpsAccuracy: number,
  tz: string | null,
  date: string
): void {
  if (db === null) return;
  db.run(
    'UPDATE items SET lat = ?, lon = ?, gps = ?, gps_accuracy = ?, tz = ?, date = ? WHERE uuid = ?',
    [lat, lon, gps, gpsAccuracy, tz, date, uuid]
  );
}

export function updateItemDate(uuid: string, date: string): void {
  if (db === null) return;
  db.run('UPDATE items SET date = ? WHERE uuid = ?', [date, uuid]);
}

export interface AlbumFileInfo {
  visible: boolean;
}

export function getAlbumFiles(album: string): Map<string, AlbumFileInfo> {
  if (db === null) return new Map();
  const rows = db
    .query<{ filename: string; visible: number }, [string]>(
      'SELECT filename, visible FROM album_files WHERE album = ?'
    )
    .all(album);
  const map = new Map<string, AlbumFileInfo>();
  for (const row of rows) {
    map.set(row.filename, { visible: row.visible === 1 });
  }
  return map;
}

export function setFileVisible(
  album: string,
  filename: string,
  visible: boolean
): void {
  if (db === null) return;
  db.run(
    `INSERT INTO album_files (album, filename, visible) VALUES (?, ?, ?)
     ON CONFLICT (album, filename) DO UPDATE SET visible = excluded.visible`,
    [album, filename, visible ? 1 : 0]
  );
}

export function deleteAlbumFile(album: string, filename: string): void {
  if (db === null) return;
  db.run('DELETE FROM album_files WHERE album = ? AND filename = ?', [
    album,
    filename
  ]);
}
