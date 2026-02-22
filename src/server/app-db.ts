import { Database } from 'bun:sqlite';

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
