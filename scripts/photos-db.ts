/**
 * Read-only access to Apple Photos SQLite database using bun:sqlite.
 *
 * Replaces osxphotos query calls with direct SQL queries.
 * Run standalone: bun scripts/photos-db.ts [--library PATH] [--uuid UUID]
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Core Data epoch: 2001-01-01 00:00:00 UTC
const CORE_DATA_EPOCH = 978307200;

export interface PhotoRecord {
  uuid: string;
  type: "photo" | "video";
  date: string; // "YYYY:MM:DD HH:MM:SS" local time
  tz: string | null; // "+HH:MM"
  lat: number | null;
  lon: number | null;
  duration: number | null; // seconds (videos only)
  camera: string | null;
  gps: "user" | "exif" | "inferred" | null;
  gps_accuracy: number | null;
  albums: string[];
  albumUuids: string[];
  directory: string | null;
  filename: string | null;
  originalFilename: string | null;
  hasEdits: boolean;
}

interface RawRow {
  ZUUID: string;
  ZKIND: number;
  ZDATECREATED: number | null;
  ZLATITUDE: number | null;
  ZLONGITUDE: number | null;
  ZDURATION: number | null;
  ZHIDDEN: number;
  ZTRASHEDSTATE: number;
  ZADJUSTMENTSSTATE: number;
  ZDIRECTORY: string | null;
  ZFILENAME: string | null;
  ZORIGINALFILENAME: string | null;
  ZTIMEZONEOFFSET: number | null;
  ZTIMEZONENAME: string | null;
  ZGPSHORIZONTALACCURACY: number | null;
  ZCAMERAMAKE: string | null;
  ZCAMERAMODEL: string | null;
  Z_PK: number;
}

interface AlbumRow {
  assetPk: number;
  albumTitle: string;
  albumUuid: string;
}

interface JoinTableInfo {
  tableName: string;
  albumColumn: string;
  assetColumn: string;
}

interface AlbumEntry {
  albumTitle: string;
  albumUuid: string;
}

// ---------- Database lifecycle ----------

export function openPhotosDb(libraryPath?: string): Database {
  const libPath =
    libraryPath ??
    join(homedir(), "Pictures/Photos Library.photoslibrary");
  const dbPath = join(libPath, "database/Photos.sqlite");

  if (!existsSync(dbPath)) {
    throw new Error(`Photos database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });
  validateSchema(db);
  return db;
}

function validateSchema(db: Database): void {
  const required: Record<string, string[]> = {
    ZASSET: [
      "Z_PK",
      "ZUUID",
      "ZDATECREATED",
      "ZLATITUDE",
      "ZLONGITUDE",
      "ZDURATION",
      "ZKIND",
      "ZHIDDEN",
      "ZTRASHEDSTATE",
      "ZADJUSTMENTSSTATE",
      "ZDIRECTORY",
      "ZFILENAME",
    ],
    ZADDITIONALASSETATTRIBUTES: [
      "ZASSET",
      "ZGPSHORIZONTALACCURACY",
      "ZTIMEZONEOFFSET",
      "ZTIMEZONENAME",
      "ZORIGINALFILENAME",
    ],
    ZEXTENDEDATTRIBUTES: ["ZASSET", "ZCAMERAMAKE", "ZCAMERAMODEL"],
    ZGENERICALBUM: ["Z_PK", "ZUUID", "ZTITLE", "ZKIND"],
  };

  for (const [table, columns] of Object.entries(required)) {
    const info = db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all();
    if (info.length === 0) {
      throw new Error(`Missing table: ${table}`);
    }
    const existing = new Set(info.map((r) => r.name));
    for (const col of columns) {
      if (!existing.has(col)) {
        throw new Error(`Missing column ${table}.${col}`);
      }
    }
  }
}

// ---------- Join table discovery ----------

function discoverJoinTable(db: Database): JoinTableInfo {
  const tables = db
    .query<
      { name: string },
      []
    >("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Z_%ASSETS' AND name GLOB 'Z_[0-9]*ASSETS' ORDER BY name")
    .all();

  for (const { name } of tables) {
    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(${name})`)
      .all()
      .map((r) => r.name);

    const albumCol = cols.find((c) => /^Z_\d+ALBUMS$/.exec(c) !== null);
    const assetCol = cols.find((c) => /^Z_\d+ASSETS$/.exec(c) !== null);

    if (albumCol !== undefined && assetCol !== undefined) {
      return { tableName: name, albumColumn: albumCol, assetColumn: assetCol };
    }
  }

  throw new Error(
    "Could not find album-asset join table (Z_nnASSETS)"
  );
}

// ---------- Formatting helpers ----------

function formatDate(
  coreDataTimestamp: number | null,
  timezoneOffsetSeconds: number | null
): string {
  if (coreDataTimestamp === null) return "";

  const unixSeconds = coreDataTimestamp + CORE_DATA_EPOCH;
  const localSeconds = unixSeconds + (timezoneOffsetSeconds ?? 0);
  const d = new Date(localSeconds * 1000);

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function formatTzOffset(seconds: number | null): string | null {
  if (seconds === null) return null;
  const sign = seconds >= 0 ? "+" : "-";
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatCameraApple(mod: string): string | null {
  if (mod === "") { return null; }
  return mod;
}

function formatCameraBrand(m: string, mod: string): string | null {
  let cleanMake = m;
  let cleanModel = mod;

  if (m.toUpperCase().includes("OLYMPUS")) {
    cleanMake = "Olympus";
    cleanModel = mod.replace(",", "/");
  }
  if (m.toUpperCase().includes("NIKON")) {
    cleanMake = "Nikon";
  }
  if (m.toUpperCase().includes("SAMSUNG")) {
    cleanMake = "Samsung";
  }

  if (cleanModel === "") { return cleanMake; }
  return `${cleanMake} ${cleanModel}`;
}

function formatCamera(
  make: string | null,
  model: string | null
): string | null {
  const m = (make ?? "").trim();
  const mod = (model ?? "").trim();
  if (m === "" && mod === "") { return null; }
  if (m.toLowerCase() === "unknown" && (mod.toLowerCase() === "unknown" || mod === "")) {
    return null;
  }
  if (m === "Apple") { return formatCameraApple(mod); }
  if (mod.toLowerCase().startsWith(m.toLowerCase())) { return mod; }
  return formatCameraBrand(m, mod);
}

function determineGpsSource(
  accuracy: number | null
): "user" | "exif" | "inferred" | null {
  if (accuracy === null) return null;
  if (accuracy === 10.0 || accuracy === 1.0) return "user";
  if (accuracy === -1.0) return "inferred";
  if (accuracy > 0) return "exif";
  return null;
}

function roundAccuracy(val: number | null): number | null {
  if (val === null) return null;
  const r = Math.round(val * 10) / 10;
  return r === Math.floor(r) ? Math.floor(r) : r;
}

// ---------- Core query ----------

const BASE_SQL = `
  SELECT
    a.Z_PK,
    a.ZUUID,
    a.ZKIND,
    a.ZDATECREATED,
    a.ZLATITUDE,
    a.ZLONGITUDE,
    a.ZDURATION,
    a.ZHIDDEN,
    a.ZTRASHEDSTATE,
    a.ZADJUSTMENTSSTATE,
    a.ZDIRECTORY,
    a.ZFILENAME,
    aa.ZORIGINALFILENAME,
    aa.ZTIMEZONEOFFSET,
    aa.ZTIMEZONENAME,
    aa.ZGPSHORIZONTALACCURACY,
    e.ZCAMERAMAKE,
    e.ZCAMERAMODEL
  FROM ZASSET a
  LEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON a.Z_PK = aa.ZASSET
  LEFT JOIN ZEXTENDEDATTRIBUTES e ON a.Z_PK = e.ZASSET
`;

function parseCoord(val: number | null): number | null {
  if (val === null || val === -180.0) { return null; }
  return val;
}

function parseDuration(kind: number, duration: number | null): number | null {
  if (kind !== 1 || duration === null || duration === 0) { return null; }
  return duration;
}

function rowToRecord(
  row: RawRow,
  albums: AlbumEntry[]
): PhotoRecord {
  const lat = parseCoord(row.ZLATITUDE);
  const lon = parseCoord(row.ZLONGITUDE);
  const hasGps = lat !== null && lon !== null;

  return {
    uuid: row.ZUUID,
    type: row.ZKIND === 1 ? "video" : "photo",
    date: formatDate(row.ZDATECREATED, row.ZTIMEZONEOFFSET),
    tz: formatTzOffset(row.ZTIMEZONEOFFSET),
    lat,
    lon,
    duration: parseDuration(row.ZKIND, row.ZDURATION),
    camera: formatCamera(row.ZCAMERAMAKE, row.ZCAMERAMODEL),
    gps: hasGps ? determineGpsSource(row.ZGPSHORIZONTALACCURACY) : null,
    gps_accuracy: hasGps ? roundAccuracy(row.ZGPSHORIZONTALACCURACY) : null,
    albums: albums.map((a) => a.albumTitle),
    albumUuids: albums.map((a) => a.albumUuid),
    directory: row.ZDIRECTORY,
    filename: row.ZFILENAME,
    originalFilename: row.ZORIGINALFILENAME,
    hasEdits: row.ZADJUSTMENTSSTATE > 0,
  };
}

function buildRecords(
  db: Database,
  rows: RawRow[],
  joinTable: JoinTableInfo
): PhotoRecord[] {
  if (rows.length === 0) return [];

  const pks = rows.map((r) => r.Z_PK);
  const albumMap = loadAlbums(db, pks, joinTable);

  return rows.map((row) =>
    rowToRecord(row, albumMap.get(row.Z_PK) ?? [])
  );
}

function loadAlbums(
  db: Database,
  assetPks: number[],
  joinTable: JoinTableInfo
): Map<number, AlbumEntry[]> {
  if (assetPks.length === 0) return new Map();

  const placeholders = assetPks.map(() => "?").join(",");
  const sql = `
    SELECT
      j.${joinTable.assetColumn} as assetPk,
      g.ZTITLE as albumTitle,
      g.ZUUID as albumUuid
    FROM ${joinTable.tableName} j
    JOIN ZGENERICALBUM g ON j.${joinTable.albumColumn} = g.Z_PK
    WHERE j.${joinTable.assetColumn} IN (${placeholders})
      AND g.ZKIND = 2
      AND g.ZTITLE IS NOT NULL
  `;

  const rows = db.query<AlbumRow, number[]>(sql).all(...assetPks);

  const map = new Map<number, AlbumEntry[]>();
  for (const row of rows) {
    let list = map.get(row.assetPk);
    if (list === undefined) {
      list = [];
      map.set(row.assetPk, list);
    }
    list.push({
      albumTitle: row.albumTitle,
      albumUuid: row.albumUuid,
    });
  }
  return map;
}

// ---------- Public query functions ----------

export function queryPhotos(db: Database): PhotoRecord[] {
  const joinTable = discoverJoinTable(db);
  const rows = db
    .query<RawRow, []>(
      `${BASE_SQL} WHERE a.ZKIND = 0 AND a.ZHIDDEN = 0 AND a.ZTRASHEDSTATE = 0`
    )
    .all();
  return buildRecords(db, rows, joinTable);
}

export function queryVideos(db: Database): PhotoRecord[] {
  const joinTable = discoverJoinTable(db);
  const rows = db
    .query<RawRow, []>(
      `${BASE_SQL} WHERE a.ZKIND = 1 AND a.ZHIDDEN = 0 AND a.ZTRASHEDSTATE = 0`
    )
    .all();
  return buildRecords(db, rows, joinTable);
}

export function queryByUuids(
  db: Database,
  uuids: string[]
): PhotoRecord[] {
  if (uuids.length === 0) return [];
  const joinTable = discoverJoinTable(db);
  const placeholders = uuids.map(() => "?").join(",");
  const rows = db
    .query<RawRow, string[]>(
      `${BASE_SQL} WHERE a.ZUUID IN (${placeholders})`
    )
    .all(...uuids);
  return buildRecords(db, rows, joinTable);
}

export function queryEdited(db: Database): PhotoRecord[] {
  const joinTable = discoverJoinTable(db);
  const rows = db
    .query<RawRow, []>(
      `${BASE_SQL} WHERE a.ZADJUSTMENTSSTATE > 0 AND a.ZHIDDEN = 0 AND a.ZTRASHEDSTATE = 0`
    )
    .all();
  return buildRecords(db, rows, joinTable);
}

export function queryOne(
  db: Database,
  uuid: string
): PhotoRecord | null {
  const joinTable = discoverJoinTable(db);
  const rows = db
    .query<RawRow, [string]>(`${BASE_SQL} WHERE a.ZUUID = ?`)
    .all(uuid);
  const records = buildRecords(db, rows, joinTable);
  return records[0] ?? null;
}

// ---------- CLI mode ----------

if (import.meta.main) {
  const args = process.argv.slice(2);
  let libraryPath: string | undefined = undefined;
  let uuid: string | undefined = undefined;
  let mode: "all" | "photos" | "videos" | "edited" | "one" = "all";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--library" && args[i + 1] !== undefined) {
      libraryPath = args[++i];
    } else if (args[i] === "--uuid" && args[i + 1] !== undefined) {
      uuid = args[++i];
      mode = "one";
    } else if (args[i] === "--photos") {
      mode = "photos";
    } else if (args[i] === "--videos") {
      mode = "videos";
    } else if (args[i] === "--edited") {
      mode = "edited";
    }
  }

  const db = openPhotosDb(libraryPath);

  function run(): PhotoRecord[] {
    if (mode === "one") {
      if (uuid === undefined) {
        console.error("--uuid requires a UUID argument");
        process.exit(1);
      }
      const single = queryOne(db, uuid);
      return single === null ? [] : [single];
    }
    if (mode === "photos") { return queryPhotos(db); }
    if (mode === "videos") { return queryVideos(db); }
    if (mode === "edited") { return queryEdited(db); }
    return [...queryPhotos(db), ...queryVideos(db)];
  }
  const results = run();

  console.log(JSON.stringify(results, null, 2));
  db.close();
}
