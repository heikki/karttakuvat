# Python Replacement Plan

## Overview

Eliminate Python as a runtime dependency by replacing `osxphotos` CLI calls and Python scripts with TypeScript using `bun:sqlite`, `sharp`, and `osascript`.

## Current State

- 12 Python scripts in `scripts/`, all depending on `osxphotos` (Python CLI tool installed via pipx)
- 2 scripts called from the server (`set_locations.py`, `set_times.py`) — interactive edits
- 2 scripts run from CLI (`export.py`, `sync.py`) — batch operations
- 4 one-off trip fixers — already done, no need to port
- 4 utility scripts (`set_cameras.py`, `match_stereo.py`, `sync_timezones.py`, `reapply_times.py`)

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
| Pillow | export.py (thumbnails, EXIF rotation) | `sharp` |
| timezonefinder | export.py, set_locations.py, sync_timezones.py | `geo-tz` |
| zoneinfo | Several (DST-aware offsets) | `Intl.DateTimeFormat` |
| exiftool (CLI) | set_cameras.py | Same CLI from `Bun.spawn()` |
| ffmpeg (CLI) | export.py (video frames) | Same CLI from `Bun.spawn()` |

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
- `osxphotos export` → copy files from Photos library managed storage + `sharp` for HEIC→JPEG
- `osxphotos query` → bun:sqlite (from Phase 2)
- Pillow thumbnails → `sharp` resize
- ffmpeg frame extraction → same CLI call from Bun

**Hard parts:**
- iCloud download (`--download-missing`) — may need PhotoKit or accept local-only limitation
- Managed storage paths — need to find where Photos stores originals (`ZDIRECTORY` + `ZFILENAME` in ZASSET)
- HEIC→JPEG conversion — `sharp` handles this
- Incremental export tracking — reimplement `--update` logic

**Files to create:**
- New: `scripts/export.ts`
- New: `scripts/sync.ts`

**Effort:** ~2-3 days

### Phase 4: Remaining Utility Scripts

Port if still needed:
- `set_cameras.py` → TypeScript (calls exiftool CLI, straightforward)
- `sync_timezones.py` → TypeScript with `geo-tz` + bun:sqlite
- `match_stereo.py` → TypeScript with bun:sqlite
- `reapply_times.py` → TypeScript with bun:sqlite

**Effort:** ~1 day

---

## Total Effort

| Phase | Scope | Effort | Impact |
|---|---|---|---|
| 1 | Server scripts | ~1 day | No Python for interactive use |
| 2 | Read queries | ~1-2 days | No Python for metadata reads |
| 3 | Export pipeline | ~2-3 days | No Python for batch export |
| 4 | Utility scripts | ~1 day | Complete Python elimination |
| **Total** | | **~5-7 days** | |

## Risks

1. **SQLite schema stability** — Apple may change Photos.sqlite schema in macOS updates. osxphotos community tracks these; we'd maintain our own queries.
2. **Write safety** — Direct SQLite writes to Photos.sqlite are untested. May need JXA fallback.
3. **iCloud downloads** — No known way to trigger iCloud photo download from TS without PhotoKit. May need to require local library or keep osxphotos for this one operation.
4. **HEIC handling** — `sharp` requires `libvips` which handles HEIC, but installation can be tricky on some systems.

## New Dependencies

- `sharp` — image processing (thumbnails, HEIC→JPEG)
- `geo-tz` — timezone lookup from coordinates
- `bun:sqlite` — already available (built into Bun)
