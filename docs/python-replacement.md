# Python Replacement Plan

## Overview

Eliminate Python as a runtime dependency by replacing `osxphotos` CLI calls and Python scripts with TypeScript using `bun:sqlite` and macOS built-in tools (`osascript`, `sips`, `qlmanage`).

## Current State

- 12 Python scripts in `scripts/`, all depending on `osxphotos` (Python CLI tool installed via pipx)
- 2 scripts called from the server (`set_locations.py`, `set_times.py`) — interactive edits
- 2 scripts run from CLI (`export.py`, `sync.py`) — batch operations

### How osxphotos is Used

**Reads** (query metadata):
- `osxphotos query --not-hidden --only-photos --json` → all photo metadata
- `osxphotos query --not-hidden --only-movies --json` → all video metadata
- `osxphotos query --uuid-from-file FILE --json` → metadata for specific UUIDs
- `osxphotos query --edited --json` → only edited photos

**Writes** (modify Apple Photos) — osxphotos uses a hybrid approach:
- `osxphotos batch-edit --location` → **AppleScript** `set location of media item to {lat, lon}`
- `osxphotos timewarp --date --time` → **AppleScript** via PhotoScript library
- `osxphotos timewarp --timezone` → **direct SQLite write** to `ZTIMEZONEOFFSET` + `ZTIMEZONENAME` (hacky, with warnings)

**Exports** (get files out):
- `osxphotos export DIR --convert-to-jpeg --skip-original-if-edited --filename {uuid} --download-missing --update` → batch export as JPEG

### Direct SQLite Already Used

Two queries already bypass osxphotos and read `Photos.sqlite` directly:
- Video durations: `SELECT ZUUID, ZDURATION FROM ZASSET WHERE ZDURATION > 0`
- GPS accuracy: `SELECT ZUUID, ZGPSHORIZONTALACCURACY FROM ZASSET JOIN ZADDITIONALASSETATTRIBUTES ...`

### Other Python Dependencies

| Dependency | Used By | TS Replacement |
|---|---|---|
| Pillow | export.py (thumbnails, EXIF rotation) | `sips` (macOS built-in) |
| timezonefinder | export.py, set_locations.py | `geo-tz` npm package |
| zoneinfo | Several (DST-aware offsets) | `Intl.DateTimeFormat` |
| ffmpeg (CLI) | export.py (video frames) | `qlmanage` (macOS built-in) |

---

## Replacement Strategy

### Phase 1: Read Queries → bun:sqlite

Replace `osxphotos query` with direct SQLite reads. This is the safest starting point — read-only, and results can be validated against osxphotos output.

**What's needed:**
- Reverse-engineer the osxphotos JSON output format (joins ~5-10 tables)
- Key tables: `ZASSET`, `ZADDITIONALASSETATTRIBUTES`, `ZEXTENDEDATTRIBUTES`, `Z_26ASSETS` (album join), `ZGENERICALBUM`
- Fields needed: uuid, date, latitude, longitude, albums, camera model, timezone offset, original filename

**Files to create:**
- New: `scripts/photos-db.ts` — SQLite query module for Photos.sqlite

**Effort:** ~1-2 days

### Phase 2: Server Scripts → TypeScript

Port `set_locations.py` and `set_times.py` to eliminate Python from interactive use. Test on a test Photos library first.

**Replace:**
- `osxphotos batch-edit --location` → AppleScript: `set location of media item id "UUID" to {lat, lon}`
- `osxphotos timewarp --date --time` → AppleScript: `set date of media item`
- `osxphotos timewarp --timezone` → direct SQLite write to `ZTIMEZONEOFFSET` + `ZTIMEZONENAME` (same approach as osxphotos)
- `timezonefinder` → `geo-tz` npm package

All AppleScript calls via `osascript` from `Bun.spawn()`. Photos.app restart after edits to clear undo stack (already done today via osascript).

**Files to create/modify:**
- New: `scripts/set-locations.ts` (or inline in `server.ts`)
- New: `scripts/set-times.ts` (or inline in `server.ts`)
- Modify: `server.ts` — call TS functions instead of spawning Python

**Risk:** Timezone SQLite writes use the same undocumented approach as osxphotos (direct write to Core Data database). Photos.sqlite has triggers that block normal UPDATE statements — osxphotos works around this with a custom sqlite wrapper. We'd need a similar workaround or use `bun:sqlite` with WAL mode. Location and date/time edits are safe (AppleScript, the supported path).

**Effort:** ~1 day

### Phase 3: Export Pipeline → TypeScript

Port `export.py` and `sync.py`.

**Replace:**
- `osxphotos export` → direct file copy from Photos library managed storage (`ZDIRECTORY` + `ZFILENAME` in ZASSET)
- `osxphotos query` → bun:sqlite (from Phase 2)
- HEIC→JPEG conversion → `sips -s format jpeg` (macOS built-in)
- Pillow thumbnails → `sips -Z 512 -s format jpeg` (macOS built-in)
- ffmpeg video frames → `qlmanage -t -s 1920` + `sips` PNG→JPEG (macOS built-in, first frame)

**iCloud-only items:** Only locally downloaded items are exported. iCloud-only items are detected via Photos.sqlite and reported (count + list) so the user can download them manually in Photos.app before re-running.

**Hard parts:**
- Incremental export tracking — reimplement `--update` logic
- Locating managed storage paths from SQLite fields

**Files to create:**
- New: `scripts/export.ts`
- New: `scripts/sync.ts`

**Effort:** ~2-3 days

---

## Total Effort

| Phase | Scope | Effort | Impact |
|---|---|---|---|
| 1 | Read queries | ~1-2 days | No Python for metadata reads |
| 2 | Server scripts | ~1 day | No Python for interactive use |
| 3 | Export pipeline | ~2-3 days | No Python for batch export |
| **Total** | | **~4-6 days** | |

## Schema Validation

Photos.sqlite schema changes across macOS versions. Dynamic join tables use numbered prefixes (e.g. `Z_33ASSETS`) that change between versions.

**Tables and columns we depend on (~5 tables, ~15-20 columns):**
- `ZASSET` — ZUUID, ZDATECREATED, ZLATITUDE, ZLONGITUDE, ZDIRECTORY, ZFILENAME, ZDURATION, local availability flag
- `ZADDITIONALASSETATTRIBUTES` — ZGPSHORIZONTALACCURACY, camera model, timezone offset
- `ZGENERICALBUM` — album names
- `Z_nnASSETS` (dynamic prefix) — album↔asset join
- `ZEXTENDEDATTRIBUTES` — original filename

**Runtime validation approach:**
1. On startup, use `PRAGMA table_info()` to verify expected columns exist
2. Discover dynamic join tables via `SELECT name FROM sqlite_master WHERE name LIKE 'Z_%ASSETS'`
3. On mismatch, fail with a clear error: "Photos.sqlite schema changed (macOS update?). Column X missing from Y."

This keeps the surface area small and catches breakage immediately rather than producing wrong results.

## Safety

**Before starting:**
- Verify Time Machine backup is current and includes Photos library
- Create a small test Photos library (`Photos > File > New Library` while holding Option at launch) — develop and test against that, not the real library

**Development order:**
1. Implement reads first (Phase 1) — validate SQLite queries return correct data by comparing against osxphotos output
2. Then writes (Phase 2) — test on test library first
3. Single-item test before batch — verify each write operation on one photo in Photos.app UI before running on multiple

**In the code:**
- `--dry-run` flag on all write operations — log what would change without touching anything
- Log old and new values before every write
- Wrap SQLite writes in transactions — rollback on error
- Re-read values after write to confirm they took effect
- Keep osxphotos installed during transition — run both old and new code in parallel, compare results

## Risks

1. **Timezone SQLite writes** — Photos.sqlite is a Core Data database with triggers that block normal UPDATE statements. osxphotos uses a hacky custom sqlite wrapper to bypass these. Need to verify `bun:sqlite` can do the same. Location and date/time writes are safe (AppleScript).

## New Dependencies

- `geo-tz` — timezone lookup from coordinates (only new npm package)
- `bun:sqlite` — already available (built into Bun)

## macOS Built-in Tools Used

- `osascript` — AppleScript for Photos.app writes (location, date/time) and restart
- `sips` — image conversion and thumbnail generation
- `qlmanage` — video frame extraction via Quick Look

## Future: Electrobun Packaging

Phases 1-3 are a prerequisite for packaging as a native macOS app with [Electrobun](https://blackboard.sh/electrobun/docs/). Electrobun uses Bun as its runtime, so all our TypeScript code runs as-is.

**What works out of the box:**
- `bun:sqlite` for Photos.sqlite reads/writes
- `Bun.spawn()` for `osascript`, `sips`, `qlmanage` calls
- `geo-tz` and all npm dependencies
- MapLibre + Lit UI in Electrobun's system webview
- 14MB app bundle, <50ms startup

**What Electrobun's native ObjC bindings could improve:**
- Replace `osascript` → direct PhotoKit calls for location/date/time writes (faster, no Photos.app window needed)
- Replace `sips` → native image APIs for HEIC→JPEG and thumbnails
- Replace `qlmanage` → native AVFoundation for video frame extraction
- Truly headless operation — no Photos.app launch required

**Not required for phases 1-3** but a natural next step once Python is eliminated.

## Scripts to Delete

One-off fix scripts and rarely-used utilities that have served their purpose:
- `fix_atlantti_times.py`, `fix_dominica_times.py` — timezone corrections for specific trips
- `update_atlantti_locations.py` — location interpolation for a sailing voyage
- `interpolate_atlantti.py` — coordinate interpolation from logbook data
- `set_cameras.py` — EXIF camera metadata copier
- `match_stereo.py` — stereoscopic photo matcher
- `sync_timezones.py` — timezone sync from coordinates
- `reapply_times.py` — time mismatch detector/fixer
