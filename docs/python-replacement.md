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

**Writes** (modify Apple Photos):
- `osxphotos batch-edit --location LAT LON --uuid UUID` → set GPS coordinates
- `osxphotos timewarp --date D --time T --uuid UUID --force` → set date/time
- `osxphotos timewarp --timezone TZ --uuid UUID --force` → set timezone

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

### Phase 1: Server Scripts → TypeScript

Port `set_locations.py` and `set_times.py` to eliminate Python from interactive use.

**Replace:**
- `osxphotos batch-edit --location` → direct SQLite write to `ZASSET` + Photos.app restart
- `osxphotos timewarp` → direct SQLite write + Photos.app restart
- `timezonefinder` → `geo-tz` npm package
- `osascript` calls → same, already non-Python

**Files to create/modify:**
- New: `scripts/set-locations.ts` (or inline in `server.ts`)
- New: `scripts/set-times.ts` (or inline in `server.ts`)
- Modify: `server.ts` — call TS functions instead of spawning Python

**Risk:** Direct SQLite writes may not be picked up by Photos.app after restart. osxphotos may use undocumented mechanisms. Needs testing — if SQLite writes don't work, fall back to JXA/AppleScript via `osascript -l JavaScript`.

**Effort:** ~1 day

### Phase 2: Read Queries → bun:sqlite

Replace `osxphotos query` with direct SQLite reads.

**What's needed:**
- Reverse-engineer the osxphotos JSON output format (joins ~5-10 tables)
- Key tables: `ZASSET`, `ZADDITIONALASSETATTRIBUTES`, `ZEXTENDEDATTRIBUTES`, `Z_26ASSETS` (album join), `ZGENERICALBUM`
- Fields needed: uuid, date, latitude, longitude, albums, camera model, timezone offset, original filename

**Files to create:**
- New: `scripts/photos-db.ts` — SQLite query module for Photos.sqlite

**Effort:** ~1-2 days

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
| 1 | Server scripts | ~1 day | No Python for interactive use |
| 2 | Read queries | ~1-2 days | No Python for metadata reads |
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

## Risks

1. **Write safety** — Direct SQLite writes to Photos.sqlite are untested. May need JXA fallback.

## New Dependencies

- `geo-tz` — timezone lookup from coordinates (only new npm package)
- `bun:sqlite` — already available (built into Bun)

## macOS Built-in Tools Used

- `osascript` — AppleScript/JXA for Photos.app control (restart after edits)
- `sips` — image conversion and thumbnail generation
- `qlmanage` — video frame extraction via Quick Look

## Scripts to Delete

One-off fix scripts and rarely-used utilities that have served their purpose:
- `fix_atlantti_times.py`, `fix_dominica_times.py` — timezone corrections for specific trips
- `update_atlantti_locations.py` — location interpolation for a sailing voyage
- `interpolate_atlantti.py` — coordinate interpolation from logbook data
- `set_cameras.py` — EXIF camera metadata copier
- `match_stereo.py` — stereoscopic photo matcher
- `sync_timezones.py` — timezone sync from coordinates
- `reapply_times.py` — time mismatch detector/fixer
