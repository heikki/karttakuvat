# Development Diary

Geotagged photo map viewer with Apple Photos integration.

## Project Stats (as of 22.02.2026)

- **TypeScript files**: 42
- **Lines of code**: 9,697
- **Total commits**: 444
- **Total tokens**: 966M | **Total cost**: $597

## Updating This Diary

Run these commands to gather data:

```bash
bunx ccusage                    # Token usage and cost per day
git log --oneline | wc -l       # Total commits
find . -name "*.ts" -o -name "*.tsx" | grep -v node_modules | grep -v .claude | xargs wc -l | tail -1  # Lines
git log --pretty=format:"%ad|%s" --date=format:"%Y-%m-%d" | head -50  # Recent commits
```

**Style guide:**

- Include token usage and cost from `bunx ccusage` when available
- Use flat bullet lists (no bold subsections or nested structure)
- Focus on significant features and fixes, skip minor tweaks
- Describe final outcomes, not intermediate attempts that were reverted

## 22.02.2026 — SQLite Migration, Album Management & View State Persistence

**Tokens**: 58M | **Cost**: $33

- Reorganized root directory structure, moved data files to `data/`
- Migrated `items.json` to SQLite `items` table in `app.db`
- Added album file management: upload/delete GPX and markdown files per album, with modal dialog
- Added per-file visibility toggles with server-side SQLite persistence
- Replaced `/api/gpx/{album}` with `/api/albums/{album}/files` for unified file management
- Persisted view state (map position, filters, style) between sessions via `settings` table and `localStorage`
- Desktop app waits for initial sync before showing the page
- Fixed image rotation for HEIC conversions and edited photos
- Removed web production build, kept dev server for debugging
- Dead code cleanup: removed unused query functions, dead api.ts module, unnecessary exports, and trivial wrappers across server and client

## 21.02.2026 — Python Replacement, Electrobun Desktop App & Native AppleScript

**Tokens**: 186M | **Cost**: $107.41

- Replaced all Python scripts with TypeScript: SQLite reads via `bun:sqlite`, export pipeline using `sips`/`qlmanage`
- Built Electrobun desktop app with application menu, window state persistence, script runner with progress
- Enriched metadata modal with EXIF fields (lens, aperture, shutter speed, ISO, focal length, flash)
- Replaced `osascript` subprocess spawning with in-process `NSAppleScript` via native dylib (`bun:ffi`)
- Fixed ESLint config and resolved all 43 lint errors

## 20.02.2026 — Code Quality & Bug Fixes

**Tokens**: 43M | **Cost**: $26.98

- Eliminated keyboard.ts by distributing logic to popup and lightbox
- Replaced 7 custom document events with callbacks object in photo-popup
- Renamed abbreviated identifiers for readability across codebase
- Fixed panToFitPopup: use easeTo, account for filter panel
- Fixed osxphotos timewarp crash on photos without timezone
- Fixed dates for 112 photos that had no timezone in Photos.app
- Added transparent hit area layer to classic markers for accurate click targets

## 19.02.2026 — Lit Components & Architecture

**Tokens**: 64M | **Cost**: $40.12

- Refactored UI to Lit web components with shadow DOM
- Reorganized file structure: co-located modules, added @common/@components path aliases
- Extracted keyboard handling, save logic, and event handling into owning modules
- Decoupled filter panel from map via typed command events
- Formatted entire codebase with Prettier

## 18.02.2026 — GPX Tracks & Timestamps

**Tokens**: 18M | **Cost**: $10.01

- Included seconds in displayed timestamps
- Added GPX track visualization for album-scoped routes

## 17.02.2026 — Classic Markers & Popup Polish

**Tokens**: 68M | **Cost**: $38.96

- Revamped classic marker style with dynamic popup offset based on zoom
- Added selected marker highlight with dark fill
- Improved popup interaction: scroll zoom around marker, pan-through behavior
- Fixed event handler leak, WebGL state restore, and marker drift at high zoom
- Fixed multiple performance issues across rendering and filtering
- Moved popup files into popup/ directory

## 16.02.2026 — Points Layer & Cleanup

**Tokens**: 68M | **Cost**: $42.26

- Refactored glow layer into three focused modules with generic Shader class
- Unified marker styles behind MarkerLayer interface
- Moved points layer into src/lib/points-layer/ with minimal public API
- Fixed glow pixelation and overexposure at close zoom
- Removed unused exports, dead functions, and stale comments

## 15.02.2026 — Visual Effects & Marker Styles

**Tokens**: 83M | **Cost**: $50.43

- Added animated cosmic background shader for globe projection
- Made stats panel collapsible
- Simplified lightbox (removed nav/close buttons)
- Added switchable marker styles: Classic (pins) and Glass/Points (glowing dots)
- Added Unreal Bloom glow layer for Points style restricted to night side
- Replaced maplibre-gl-nightlayer with built-in night shadow rendering

## 14.02.2026 — URL State & External Maps

**Tokens**: 58M | **Cost**: $34.03

- Persisted filters, selected item, map view, and map style in URL params
- Added reset button to restore initial app state
- Added Apple Maps and Google Maps buttons with marker pin
- Switched satellite tiles from Esri to Google for better coverage
- Added Thunderforest Outdoors topo layer
- Added distance measurement tool with @turf/distance
- Prevented accidental page zoom from trackpad pinch

## 13.02.2026 — Globe, Filters & Metadata

**Tokens**: 96M | **Cost**: $64.01

- Added camera info overlay and cascading filters: Year → Album → Camera
- Added photo metadata viewer via osxphotos API
- Enabled globe projection with dark background
- Added worldwide base layers behind MML maps
- Added globe/mercator toggle control
- Added day/night shadow on globe with animated transitions
- Dark mode for stats panel, filters, and popups

## 11.02.2026 — Timezones & Atlantti Voyage

**Tokens**: 55M | **Cost**: $39.07

- Added timezone offset to metadata, derived from coordinates via TimezoneFinder
- Sorted photos by UTC time instead of local time
- Added date copy/paste and manual entry to popups
- Built intra-day coordinate interpolation script for Atlantti sailing voyage photos
- Fixed timestamps for Dominica photos (Finnish time → local)

## 10.02.2026 — Map Layers & UI Overhaul

**Tokens**: 29M | **Cost**: $18.98

- Replaced OSM/CyclOSM with MML (National Land Survey) map layers
- Color-coded markers by GPS precision with pulsing highlight ring
- Added Photos overlay button and lightbox-marker sync
- Replaced dropdowns with segmented button bars for map type, media, and GPS filters
- Replaced location action links with inline buttons in popup
- Added metric scale bar

## 09.02.2026 — Export Fixes & Album Filter

**Tokens**: 27M | **Cost**: $17.75

- Added album filter and "Fit to view" button to stats panel
- Regenerated stale thumbnails when full-size image is newer
- Fixed edited photos being overwritten by originals during export
- Clean up orphan files when photos are deleted from Apple Photos

## 08.02.2026 — Location & Time Editing

**Tokens**: 27M | **Cost**: $18.71

- Added location editing: set/copy/paste photo locations, save to Apple Photos via osxphotos
- Added time adjustment with +1h/-1h buttons to shift timestamps
- Added export for all media regardless of geotag, with No Location filter

## 02.02.2026 — Stability

**Tokens**: 6M | **Cost**: $5.15

- Fixed MapLibre crash on dropdown selections

## 28.01.2026 — Video Support

**Tokens**: 24M | **Cost**: $15.12

- Added video support to map with unified export pipeline
- Added media type filter and GPS accuracy tracking

## 27.01.2026 — Export Pipeline & Navigation

**Tokens**: 28M | **Cost**: $16.87

- Added docs with app spec, user flows, and timeline plan
- Added arrow key navigation in photo popups
- Built photo export pipeline with progress counters, edited file handling, and orphan cleanup
- Detected user-set locations via Photos database GPS accuracy
- Fixed MapLibre crash when changing filters during animation

## 26.01.2026 — Lint Fixes

**Cost**: $0.00

- Resolved all remaining 19 lint errors

## 19.01.2026 — Project Bootstrap

**Tokens**: 10M | **Cost**: $6.77

- First commit: initial codebase with map display of geotagged photos
- Migrated to Bun + TypeScript from vanilla JS
- Fixed type and lint errors, added popup keyboard navigation
