# App Specification

Karttakuvat displays geotagged photographs and videos on an interactive map. Metadata is synced from the Apple Photos SQLite database; images are converted on demand via a native ObjC++ dylib (ImageIO/AVFoundation) loaded through `bun:ffi`. The dev server and desktop app provide API endpoints for editing metadata back into Photos.app via in-process NSAppleScript (loaded through the same native dylib).

## Architecture

UI is built with Lit web components (`LitElement`):

- `<filter-panel>` — filters, stats, and controls (top-right)
- `<photo-popup>` — single-photo popup on the map
- `<photo-lightbox>` — full-screen photo viewer
- `<metadata-modal>` — detailed photo metadata overlay
- `<placement-panel>` — location placement UI
- `<album-files-modal>` — album file management dialog

### Map modules

The map is composed of small sibling modules under `src/client/map/` — `selection`, `markers/`, `route/`, `gpx`, `measure`, `placement`, `popup/`, `fit`, `z-anchors`. Each `default-exports` a small object whose public methods drop the redundant module-name affix (e.g. `selection.init`, `popup.get`, `route.save`); consumers always import via `import name from './module'`. Each module's `init(map)` wires its own state (via `map.on('load', ...)` for layer setup, plus event/data subscriptions). Cross-module communication goes through two seams: shared state modules (`selection`, `edits`) that the relevant subscribers read and observe, and bare `document` events for one-way request signals (`EnterPlacementModeEvent`, `RouteEditModeChangedEvent`, `MeasureModeExitedEvent`, `AlbumFilesChangedEvent`).

### Selection

`selection.ts` owns the focused-photo state machine: `mode` ∈ `idle | popup | placement` plus the selected `photoUuid`. Markers, popup, and placement subscribe and react — the popup module mounts/unmounts the MapLibre Popup based on mode, markers toggle visibility and apply highlight, placement shows/hides the panel and crosshair. Selection auto-clears when the selected photo leaves the filtered set, and restores the photo from the URL `id` param after photos load.

### Pending edits

`common/edits.ts` owns pending coordinate edits, pending time offsets (hour deltas), and the `isSaving` flag. Two channels: `data.subscribe` fires on filter changes, `edits.subscribe` fires on edit changes. Subscribers that care about effective photo positions (markers, popup, route) listen to both; selection only listens to filter changes. `getEffectiveCoords/Date/Location(photo)` are the read API — they apply pending edits over the stored photo data.

### Layer ordering (z-anchors)

`zAnchors.init(map)` installs four empty placeholder layers — `z-gpx`, `z-route`, `z-markers`, `z-measure` — threaded together with `beforeId`. Every module's `addLayer` call passes its band's anchor (`zAnchors.id('gpx')` etc.) as `beforeId`, so layers always stack in band order regardless of init order or basemap swap (the anchors are preserved across `setStyle` by `transformStyle`).

## Startup

1. `map.init()` — creates the MapLibre map with globe projection, then calls `selection.init`, `zAnchors.init`, `popup.init`, `measure.init`, `route.init`, `fit.init`, `gpx.init`, `markers.init`, `placement.init` and starts the globe background shader. Each module registers its own `map.on('load')` handler for layer setup.
2. `initSave()` — wires up save/edit event listeners
3. `loadPhotos()` — fetches items from `/api/items`, sorts by date
4. `<filter-panel>` detects loaded photos via `updated()` lifecycle hook, restores filters/map style/marker style/tracks visibility from URL, validates cascading filter options, applies filters, and dispatches initial map style/marker style/GPX visibility events
5. On map load: each module's load handler adds its own sources/layers using its z-anchor as `beforeId`. Popup reopens from URL; fit zooms to filtered photos unless a map view was restored from URL.

## Filters

Five filters that apply together, with cascading dependencies:

### Dropdowns (cascading)

- **Year**: populated from unique years. Changing year cascades to repopulate Album and Camera options.
- **Album**: populated from albums of photos matching the current year. Changing album cascades to repopulate Camera options.
- **Camera**: populated from cameras of photos matching current year + album.

### Toggle Buttons

- **Media**: Photos / Videos. Toggle buttons (active = included). Single-click toggles one button. Double-click solos that button (deactivates all others).
- **Location**: Exif / Inferred / User / None. Same toggle/solo behavior. Color-coded to match marker colors (blue/amber/green/gray). Default excludes "None" — photos without GPS are hidden by default.

Changing any filter recomputes the filtered set and notifies:

1. Stats — updates count
2. Map — updates markers (only if style is fully loaded; changes during style transitions are silently dropped)

## Map

MapLibre GL JS with raster tile sources. Style switching via buttons:

- **Aerial** (default): Google Satellite
- **Topo**: Google Terrain
- **Maasto**: MML Maastokartta over white background (hidden when `PUBLIC_MML_API_KEY` is not set)
- **Orto**: MML Ortokuva over white background (hidden when `PUBLIC_MML_API_KEY` is not set)

Selected map style is persisted in URL params (default `satellite` is omitted from URL). App-owned layers (GPX, photo, route, measure) persist across style swaps via MapLibre's `transformStyle` callback.

### Projection

The map uses globe projection by default. A globe control (bottom-right) lets the user toggle between globe and mercator projections. When switching projection, the current popup is re-rendered at its position.

### Controls

- Navigation control (zoom +/-, no compass) at bottom-right
- Globe control (projection toggle) at bottom-right
- Scale bar (metric) at bottom-left
- Drag rotate disabled

### Marker Styles

Two switchable marker styles, selectable via buttons in the filter panel. The active marker style is persisted in URL params.

**Classic** (default): Color-coded circles by GPS type. Five layers:

- **Hit area** (`classic-hit-area`): Transparent circles used as the click target. Zoom-dependent radius (6–16px). This is the layer used for marker interaction detection.
- **Outlines** (`classic-outlines`): White rings behind all fills. Zoom-dependent radius (4–12px). Pitch-aligned to map.
- **Markers** (`classic-markers`): Color-coded fills by GPS type. No stroke. Zoom-dependent radius (3–10px). Sorted by latitude (northern behind southern) then index.
  - Blue (`#3b82f6`): exif
  - Amber (`#f59e0b`): inferred
  - Green (`#22c55e`): user
  - Gray (`#9ca3af`): none
- **Selected highlight** (`classic-selected-highlight`): Semi-transparent dark fill with white stroke, larger radius (6–16px). Filtered by UUID. Creates a highlight ring behind the selected marker.
- **Selected** (`classic-selected`): Colored dot with white outline on top of highlight. Same radius as markers. Filtered by UUID.

**Points**: Minimalist white dots with WebGL bloom glow effect.

- **Markers** (`points-markers`): Transparent hit-area circles with zoom-dependent radius (6–30px). Pitch-aligned to map.
- **Dots** (`points-dot`): Small white circles with blur, zoom-dependent radius (1–7px). Pitch-aligned to map.
- **Selected** (`points-selected`): Same hit-area paint, filtered by UUID.
- **Bloom** (`points-bloom`): Custom WebGL layer that renders glowing point sprites with multi-pass Gaussian blur, composited additively. Includes night shadow rendering in globe mode.

### Night Layer

Day/night shadow overlay rendered as a custom WebGL layer (part of the Points bloom layer). Uses subsolar point calculation to determine sun position. Visible only in globe projection.

### Globe Background

Animated cosmic background (nebula + twinkling stars) rendered via a separate WebGL2 canvas behind the map. Two-pass rendering: expensive nebula texture rendered to FBO only when map is idle, cheap blit shader composites cached texture + live globe glow every frame. Visible only in globe projection. Pauses animation during map interaction to save GPU. Renders at half resolution, capped at 30fps.

Default center: Kuhmo, Finland (29.52, 64.13). Zoom 10. Box zoom, double-click zoom, and keyboard navigation disabled.

### Map Fitting

- **Initial load**: fit to all photos (skipped if map view is restored from URL)
- **"Fit" button**: fits to all filtered photos with animation; keeps current selection unless the oldest or newest photo is selected — selecting the oldest toggles to newest and vice versa; selects oldest if nothing is open
- **Padding**: top dynamic (350 in mercator; in globe: popup height + 60 or 50 if no popup), bottom 40, left 50, right 270 (accounts for filter panel)
- **Max zoom**: 18
- **Single point**: centers at zoom 14 instead of fitting bounds

### Auto-Pan

When a popup opens or navigates to a new photo, the map automatically pans to keep the popup fully visible within the viewport (with padding for the filter panel on the right).

### Marker Click

- Click marker: opens single-photo popup
- Click map background: closes popup

## Placement Mode

Allows setting a photo's location by clicking on the map.

1. Activated via "set" button in popup location row
2. Closes any open popup
3. Shows placement panel (thumbnail + date + "Click map to set location" hint)
4. Changes cursor to crosshair
5. Hides all photo markers (markers stay hidden if map style is changed during placement)
6. Click on map: sets the location as a pending edit, exits placement mode, reopens popup at new location
7. Escape: cancels placement mode

## Popups

### Popup Behavior

- **Dynamic offset**: Popup is positioned above the marker with an offset based on the marker's visual radius at the current zoom level. Re-anchored on zoom changes.
- **Scroll zoom**: Mouse wheel on the popup or map canvas zooms around the selected marker (not the cursor), keeping the marker at the same screen position.
- **Pan-through**: Mouse drag on the popup (outside buttons, links, inputs) is forwarded to the map canvas for panning.

### Single Photo

Shown on marker click:

- Image wrap with thumbnail (click opens lightbox)
- Video indicator overlay (play icon) for video items
- Overlay buttons on image: info button (opens metadata modal), Photos.app link
- Date line with time adjustment controls:
  - Normal mode: formatted date + copy/paste/edit buttons
  - Edit mode: ±1d, ±1h buttons + done button + manual date input field
- Location line: formatted coordinates + set/copy/paste buttons
- Arrow keys navigate to next/prev photo in the filtered set (wrapping), moving the popup to each marker
- Closing clears marker highlight

## Date/Time Editing

Available in the popup:

- **Copy**: copies current photo's effective date (including pending offsets)
- **Paste**: applies copied date to current photo (shown only when copied date differs)
- **Edit**: enters edit mode with ±1d, ±1h buttons for quick adjustments
- **Manual entry**: text input accepting `D.M.YYYY HH:MM` or `D.M HH:MM` (falls back to photo's year). Press Enter to apply, Escape to cancel.

All date changes are stored as hour offsets in pending edits until saved.

## Location Editing

- **Set**: enters placement mode (click map to set location)
- **Copy**: copies current photo's effective location to clipboard
- **Paste**: applies copied location to current photo (shown only when copied location differs)

Location changes are stored as pending edits until saved.

## Pending Edits

When location or time edits exist:

- Edit section appears in filter panel showing count of pending edits
- **Save to Photos**: POST to `/api/save-edits`, reloads data, reopens current popup. Shows alert on error.
- **Discard**: clears all pending edits

Pending edits are reflected immediately on the map (markers move to new positions) and in popups (dates show adjusted values).

## Lightbox

Full-screen overlay for browsing all filtered photos sequentially. Activated by clicking image in popup or pressing Space when popup is open.

Controls: left/right arrow keys to navigate, Escape or backdrop click to close. Trackpad pinch zooms (anchored at cursor, 1×–8×) and two-finger scroll pans when zoomed in; zoom resets when navigating to another photo. Shows date with timezone, coordinates, and camera name in a shared pill in the top-left corner, plus "Open in Photos" and info buttons in the top-right.

**Videos**: played inline via `<video>` element with the original file streamed from the Photos library (HTTP range-aware, no copying or transcoding). Native controls appear on mouse movement and hide after 3 seconds of inactivity. Space toggles play/pause. Mute state is shared across videos within the same session.

## Metadata Modal

Full-screen overlay showing detailed photo metadata from Photos.app (via direct Photos.sqlite query).

- Activated by info button on popup or lightbox overlay
- Fetches from `/api/metadata/:uuid`
- Shows table of metadata fields: filename, original filename, dates (created as local time / added / modified as UTC), timezone, title, description, keywords, albums, persons, camera, lens, aperture, shutter speed, ISO, focal length, flash, dimensions, file size, duration, UTI, coordinates, GPS accuracy, flags (favorite, hidden, video, HDR, screenshot), UUID (with copy button)
- Empty/false fields are hidden
- Close with X button, backdrop click, or Escape
- Blocks all keyboard events except Escape while open

## GPX Track Overlay

Displays GPX track data on the map when an album is selected.

- On album filter change, fetches file list from `/api/albums/{album}/files`
- Loads visible `.gpx` files from `data/albums/{album}/{filename}`
- Parses GPX tracks (`<trk>`) and waypoints (`<wpt>`), including elevation data
- Computes total track distance (via `@turf/distance`) and elevation gain/loss
- Each album gets a color from a rotating palette of 8 colors

### GPX Layers (4 layers)

- **Track outline** (`gpx-track-outline`): Black shadow line (width 6, opacity 0.4)
- **Track line** (`gpx-track-line`): Colored line (width 3, opacity 0.85), rounded caps and joins
- **Waypoint circles** (`gpx-waypoint-circles`): White circles with colored stroke (radius 5)
- **Waypoint labels** (`gpx-waypoint-labels`): White text with dark halo, offset below circle

### Track Visibility

GPX track visibility is controlled per-file via the album files modal. Hidden files are excluded from track rendering on the map. Visibility state is persisted in the `album_files` table in `app.db`.

## Photo Route

Displays a route connecting filtered album photos in chronological order. Only available when a specific album is selected (not "all albums").

### Route Display

When toggled on via the "Route" button in the filter panel, a route line connects all filtered photos sorted by UTC time. Three map layers:

- **Route outline** (`photo-route-outline`): Black line (width 4, opacity 0.3)
- **Route line** (`photo-route-line`): Blue line (#60a5fa, width 2)
- **Route highlight** (`photo-route-highlight`): White line (width 2, hidden by default)

If a saved route exists for the album (with custom waypoints or routing methods), it is loaded from the server. Otherwise, a default straight-line route is built from the filtered photos.

### Route Reconciliation

When a saved route is loaded (toggle-on or album switch), it is reconciled against the current album: photo points whose photos are no longer in the album (or have lost their location/date) are dropped, remaining points have their coordinates and chronological order refreshed, and photos newly added to the album are inserted at chronologically correct positions with straight-line segments. The reconciled route is persisted if its structure changed and no edits are pending.

Reconciliation runs at load time only — not on every photo edit while the route is hidden — so the file on disk may be briefly stale until the route is next opened. Custom routed segments (driving/hiking) split by an inserted point fall back to straight; the user can re-route them via the Edit UI.

### Route Editing

Activated via the "Edit" button (appears when route is visible). Enters an interactive editing mode with crosshair cursor and six map layers for points, lines, and hit targets.

**Operations:**

- **Add waypoint**: Click on a route segment to insert a waypoint at that position
- **Remove waypoint**: Click on an existing waypoint to delete it (photo points cannot be removed)
- **Drag point**: Mousedown + drag any point to move it; adjacent segments update in real-time
- **Change routing method**: Right-click a segment to open a popup with method options

**Routing methods** (per segment):

- **Straight**: Direct line between points (default)
- **Driving**: OpenRouteService driving-car profile (hidden when `PUBLIC_ORS_API_KEY` is not set)
- **Hiking**: ORS foot-hiking profile (hidden when `PUBLIC_ORS_API_KEY` is not set)
- **None**: Hides the segment (no line drawn)

Routed segments (driving/hiking) are automatically re-routed via ORS when waypoints are added or dragged. On routing failure (no ORS key, request error, etc.), the segment's method downgrades to straight. Waypoints cannot be inserted on "none" segments.

**Point types** (visual distinction in edit mode):

- **Photo points**: Larger circles (3–10px), color-coded by GPS type
- **Waypoints**: Smaller circles (1.5–5px), same color coding

**Persistence**: Routes are auto-saved to the server (1s debounce) via PUT `/api/albums/{album}/route`. Route visibility is persisted in URL params.

**Exit**: Press Escape or click the "Edit" button again. Switching to "all albums" also exits edit mode.

### Route API

- `GET /api/albums/{album}/route` — load saved route data
- `PUT /api/albums/{album}/route` — save route (points + segments with geometries)
- `DELETE /api/albums/{album}/route` — clear saved route
- `POST /api/route` — proxy to OpenRouteService for segment routing (requires ORS API key via env var or DB setting)

## Measurement Mode

Interactive distance measurement tool for measuring distances on the map.

1. Activated via "Measure" button in the filter panel view-buttons row
2. Cursor changes to crosshair
3. Click on map: adds a point, connected to previous points by a dashed red line
4. Distance overlay appears at top-center showing cumulative distance (meters below 1 km, kilometers with 2 decimals otherwise)
5. Click an existing measurement point: removes it from the path
6. Escape or click "Measure" button again: exits measurement mode and clears all points
7. "Reset" button also exits measurement mode

## Filter Panel

Fixed top-right (220px wide). Collapsible — clicking the header toggles the panel body. Implemented as `<filter-panel>` Lit web component. Shows:

- Title "Karttakuvat" (clickable header to collapse/expand)
- Item count (photos and/or videos)
- Filter section: Year, Album, Camera dropdowns; Media and Location toggle buttons; Map style buttons; Marker style buttons (Classic/Points)
- "Fit" button — fits map to filtered photos; keeps current selection unless oldest or newest is open (toggles between them); selects oldest if nothing is open
- "Reset" button — closes popup, exits measure mode, resets all filters/map style/marker style to defaults, clears and immediately persists all URL params, fits to all photos
- "Measure" button — toggles distance measurement mode (highlighted blue when active)
- "Route" button (conditional) — toggles photo route display (only shown when a specific album is selected)
- "Edit" button (conditional) — enters route editing mode (only shown when route is visible)
- "Files" button (conditional) — opens album files management modal (only shown when an album is selected)
- "Apple Maps" button — opens Apple Maps at the current map center or selected photo location (satellite view)
- "Google Maps" button — opens Google Maps at the current map center or selected photo location
- Pending edits section (hidden when no edits): count + Save/Discard buttons

## URL State

App state is persisted in URL query parameters:

- **Filters**: `year`, `album`, `camera`, `gps` (comma-separated), `media` (comma-separated). Default values are omitted.
- **Photo**: `id` (UUID of currently viewed photo)
- **Map view**: `lat`, `lon`, `z` (zoom) — updated on every map move
- **Map style**: `style` (e.g. `topo`, `mml_maastokartta`). Default `satellite` is omitted.
- **Marker style**: `markers` (e.g. `points`). Default `classic` is omitted.
- **Route**: `route` (present when route is visible for the selected album)

On startup, saved URL state is restored: filters are applied, map view is positioned, map style is set, marker style is set, and the selected photo popup is reopened. The Reset button clears all URL params.

## Album Files Management

Each album can have associated GPX tracks and markdown notes, managed via the album files modal.

- **Open**: "Files" button appears in the filter panel when an album is selected
- **Upload**: drag-and-drop or file picker for `.gpx` and `.md` files, uploaded via POST `/api/albums/{album}/upload`
- **Storage**: files stored on disk in `data/albums/{album_name}/`
- **Visibility**: each file has a toggle to show/hide it; state persisted in `album_files` table in `app.db`
- **Deletion**: files can be deleted via the modal, removing both the disk file and DB record
- **GPX integration**: hidden files are excluded from track rendering on the map

## Data Storage

Photo metadata is stored in the `items` table in `app.db` (SQLite), populated by the sync script from the Apple Photos database. The API serves items via GET `/api/items`. The `settings` table stores app state (window position, view state). The `album_files` table tracks per-file visibility for album assets.

### View State Persistence

Map position, filters, map style, and marker style are persisted between sessions:

- **Desktop app**: saved to the `settings` table (key `view`) via PUT `/api/view-state`, restored on startup by building the URL with saved query params
- **Web version**: saved to `localStorage`, restored synchronously at module load before components initialize
- Both use debounced 1-second save on state changes

## Desktop App (Electrobun)

The app is packaged as a native macOS desktop app using Electrobun (Bun + system webview). Entry point: `src/app/index.ts`.

### Architecture

A single `Bun.serve({ port: 0 })` instance serves both bundled view files and API routes on the same origin. The webview loads from `http://127.0.0.1:PORT`. Images are converted on demand via the native bridge (`libkarttakuvat.dylib`). In dev builds, scripts run from the project `scripts/` directory using system Bun; in installed builds, bundled `.js` scripts run via the bundled Bun binary.

### Application Menu

- **Karttakuvat**: About Karttakuvat, Quit (Cmd+Q)
- **Photos**: Sync Photos, Clear Cache
- **Window**: Minimize, Close

### Script Runner

Menu actions trigger scripts (`sync.ts`) via `Bun.spawn()`. Progress is shown in the window title (with ANSI escape code stripping and carriage return handling for live updates). Only one script runs at a time. On completion, a success/error dialog shows the last few output lines, and the webview reloads.

### Auto-Sync on Startup

On launch, the app automatically runs a quiet sync (`sync.ts`) in the background. Progress is shown in the window title. On success, the webview reloads silently. On failure, the error is logged but no dialog is shown.

### iCloud Drive Backup

On startup (production only), the app backs up album data to iCloud Drive at `~/Library/Mobile Documents/com~apple~CloudDocs/Karttakuvat/`. Skipped silently if iCloud Drive is not available.

- **Incremental mirror**: copies `albums/` to `Karttakuvat/latest/`, skipping files that haven't changed (mtime-based)
- **Daily snapshots**: creates a dated copy in `Karttakuvat/snapshots/YYYY-MM-DD/` once per day
- **Pruning**: removes snapshots older than 30 days

### Image Cache

Images are converted on demand from the Apple Photos library using a native ObjC++ dylib (`libkarttakuvat.dylib`) loaded via `bun:ffi`. The dylib uses ImageIO for HEIC/JPEG conversion and thumbnailing, and AVFoundation for video frame extraction — no subprocess spawning or temp directories needed. Full-size and thumbnail images are cached in `{dataDir}/cache/full/` and `{dataDir}/cache/thumb/` respectively, validated by source file mtime. The "Clear Cache" menu action deletes both cache directories and reloads the webview.

Videos in the lightbox are streamed directly from `Photos Library.photoslibrary/originals/` via `GET /video/:uuid` with HTTP range support (seeking). No conversion or caching — the original `.mov`/`.mp4` file is served with `Content-Type: video/quicktime` or `video/mp4`.

### Window State Persistence

Window position and size are saved to the `settings` table in `app.db` (key `window`) on move/resize (debounced 500ms) and restored on launch.

### External Link Handling

Links with `target="_blank"` and `window.open()` calls are intercepted and opened in the system browser instead of in-app navigation.

### Full Disk Access

If the `/api/metadata/:uuid` endpoint returns a 500 error indicating Photos.sqlite can't be read, a one-per-session dialog prompts the user to grant Full Disk Access in System Settings.

### Data Directory

Dev builds use `data/` in the project root. Installed builds use `~/Library/Application Support/Karttakuvat/` (overridable via `KARTTAKUVAT_DATA_DIR` env var). Contains `app.db`, `cache/` (image cache), and `albums/` (GPX/markdown files).

## Keyboard Shortcuts

| Key        | Context               | Action                         |
| ---------- | --------------------- | ------------------------------ |
| Escape     | Metadata modal open   | Close metadata modal           |
| Escape     | Date edit mode        | Exit date edit mode            |
| Escape     | Measure mode          | Exit measurement mode          |
| Escape     | Route edit mode       | Exit route edit mode           |
| Escape     | Placement mode        | Cancel placement mode          |
| Escape     | Lightbox open         | Close lightbox                 |
| Escape     | Popup open            | Close popup                    |
| Space      | Lightbox open (photo) | Close lightbox                 |
| Space      | Lightbox open (video) | Toggle play/pause              |
| Space      | Popup open            | Open lightbox                  |
| Left/Right | Lightbox open         | Navigate photos                |
| Left/Right | Popup open            | Navigate photos (all filtered) |
| Enter      | Date input focused    | Apply manual date              |
| Shift+D    | Any                   | Toggle diagnostics overlay     |
