# App Specification

Karttakuvat displays geotagged photographs and videos on an interactive map. Metadata is synced from the Apple Photos SQLite database; images are converted on demand via a native ObjC++ dylib (ImageIO/AVFoundation) loaded through `bun:ffi`. The dev server and desktop app provide API endpoints for editing metadata back into Photos.app via in-process NSAppleScript (loaded through the same native dylib).

## Architecture

UI is built with Lit web components (`LitElement`):

- `<filter-panel>` — filters, stats, and controls (top-right)
- `<photo-popup>` — single-photo popup on the map
- `<photo-lightbox>` — full-screen photo viewer
- `<metadata-modal>` — detailed photo metadata overlay
- `<placement-panel>` — location placement UI
- `<files-modal>` — album file management dialog

### Map modules

The map is composed of `<map-*>` Lit elements, each owning its own directory under `src/client/components/`. Single-file features (`<map-fit>`, `<map-placement>`, `<map-measure>`, `<map-gpx>`) hold all their state and lifecycle in `index.ts`. Multi-file features (`<map-popup>`, `<map-route>`, `<map-markers>`) keep helpers in sibling files alongside the element class. Map-view-internal infrastructure (globe shader, basemap config) lives in `components/map-view/` alongside the orchestrator; cross-cutting state (`data`, `edits`, `selection`, `view-state`) lives in `common/`.

#### MapApi — the public seam

`components/map-view/api.ts` defines the `MapApi` interface — a narrow surface listing exactly the cross-feature operations: `map`, `fitToPhotos`, `reloadGpx`, `forceRemountPopup`, `popupElement`, `markerRadius`, `openExternal`. `<map-view>` `implements MapApi`, with each method a one-line forwarder that does a `renderRoot.querySelector` to the relevant feature element and calls into it. Map-view is the only place that knows about its shadow children.

Two consumer paths use the same surface:

- **In-tree consumers (sibling map features)** — `<map-popup>`, `<map-fit>`, etc. — consume `MapApi` via `mapContext`. The provider on `<map-view>` is initialised with `this` as its initial value, so any feature mounting inside the shadow gets a typed handle the moment `@consume` runs. A feature accesses the map as `this.api.map` and calls siblings as `this.api.markerRadius(z)` or `this.api.popupElement()`. `document.querySelector` lookups don't appear inside features.
- **Out-of-tree callers** — `actions.ts`, panel components that are siblings of `<map-view>` under `<app-root>` rather than descendants. `mapContext` doesn't flow sideways to them, so they reach the same methods via `document.querySelector('map-view')?.fitToPhotos(...)`. The host element lives in light DOM, so the lookup always resolves; the forwarder then does the shadow-internal lookup.

Adding a cross-feature operation is a deliberate two-step: declare it in `MapApi`, implement the forwarder. The contract can't widen accidentally.

### State and commands

State is held in `@lit-labs/signals`, organised into a few stores. Lit components opt into reactivity via the `SignalWatcher` mixin and read signals in `render()`; non-component modules use `effect()` from `@common/signals` for module-level reactions. Commands (one-shot actions) are exposed as plain functions through a single `@common/actions` module — components import from `actions` for app-level commands, so the command surface stays in one place. `actions.ts` reaches the map by calling methods on `<map-view>` (which `implements MapApi`); see the MapApi section above. Cross-cutting reads — `selection.getPhoto()`, `data.filteredPhotos.get()`, `edits.getEffectiveLocation(photo)` — go directly to their store modules.

- `@common/data` — `photos` and `filters` signals; `filteredPhotos` computed.
- `@common/edits` — `pendingCoords`, `pendingTimeOffsets`, `saving` signals; `editCount` computed; function-form readers `getEffectiveCoords/Date/Location(photo)` wrap the underlying signals so any tracking context picks them up.
- `@common/view-state` — `mapStyle`, `markerStyle`, `routeVisible` signals; each is seeded from the URL at module load and persisted back via an effect.
- `@common/selection` — `selectedPhotoUuid` and `interactionMode` signals (see below).

### Selection

`selection.ts` splits the focused state into two orthogonal signals:

- `selectedPhotoUuid: Signal<string | null>` — which photo (if any) is currently selected. Persisted to the URL `id` param via an effect.
- `interactionMode: Signal<'idle' | 'placement' | 'measure' | 'route-edit'>` — the exclusive map-input mode. Because all three exclusive modes live in one enum, they're mutually exclusive by construction; entering one automatically clears the others.

`isPopupOpen()` derives from both: a popup is shown iff a photo is selected and `interactionMode !== 'placement'`. Markers, popup, and placement react via `effect()` on these signals — the popup module mounts/unmounts the MapLibre Popup, markers re-render with selection state, placement shows/hides its panel. Selection auto-clears when the selected photo leaves the filtered set; the URL-restore path runs once when photos first load.

### Layer ordering (DOM-order z)

Cross-feature layer order is the order of `<map-*>` elements in `<map-view>`'s feature template — bottom to top: `<map-gpx>`, `<map-route>`, `<map-markers>`, `<map-measure>`. Each feature's `firstUpdated` calls `addLayer(...)` with no `before` argument, so the layer lands on top of whatever's already in the stack at that moment. Lit fires `firstUpdated` in document order, so template order = init order = z-order. Within a feature, the order of `addLayer` calls determines internal stacking. Layer order survives basemap swaps via `transformStyle`, which carries app-owned layers across `setStyle`.

`<map-markers>` is the one feature that swaps its layer set at runtime (classic ↔ points). It owns one extra invisible symbol layer — `markers-anchor` — added in `markers.init()` before either style is installed. Both `ClassicLayer.install` and `PointsLayer.install` take that anchor's id as their `before` argument; the anchor itself is never removed, so markers keeps its z-position across swaps even though its implementation layers come and go.

## Startup

View-state signals (`mapStyle`, `markerStyle`, `routeVisible`, `selectedPhotoUuid`) seed from the URL synchronously at module load, before any rendering, so subsequent reads always see the intended starting state.

1. `<app-root>` mounts as the body's only child. Its `connectedCallback` installs window-level error handlers (`window.__debugLog`), gesture-prevention listeners, and kicks off `data.loadPhotos()`.
2. `<app-root>` renders `<map-view>` plus the panel components.
3. `<map-view>`'s `firstUpdated` constructs the MapGL instance into a `#container` div inside its shadow root, attaches map-level listeners (background shader, error handlers, projection transitions, debug keyboard, style-change effect), and registers a single `map.once('load')` handler.
4. `loadPhotos()` resolves in parallel — fetches `/api/items`, sorts by date, writes into `data.photos`. The `filteredPhotos` computed re-derives, fanning out to every effect that reads it.
5. `<filter-panel>` detects loaded photos via `updated()`, restores filter component state from URL, and writes the normalized values into `data.filters`. The signal change cascades.
6. On map load: `<map-view>` flips an internal `@state _map`, which triggers a re-render that mounts the feature children: `<map-gpx>`, `<map-route>`, `<map-markers>`, `<map-measure>`, `<map-popup>`, `<map-fit>`, `<map-placement>`. Each feature `@consume`s `mapContext` (the `MapView` instance, typed as `MapApi`) and reads `this.api.map` from its `firstUpdated`, where it adds layers, registers map listeners, and wires `effect()`s — for multi-file features like `<map-popup>` the element delegates to internal helpers; for single-file features the work happens inline in the class. Template order = z-order for layer features. Fit zooms to filtered photos unless a map view was restored from URL.

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

Two switchable styles, persisted via the `markers` URL param. Sources: `components/map-markers/classic.ts` and `components/map-markers/points/`.

- **Classic** (default): color-coded circles by GPS type — blue (exif), amber (inferred), green (user), gray (none). Larger transparent hit area for easier clicking; selected marker gets a darker highlight ring with white stroke.
- **Points**: white glow dots, rendered via a custom WebGL layer with multi-pass Gaussian blur composited additively. Larger hit area for clicking. Includes a day/night shadow overlay in globe projection (subsolar point calculation).

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

When an album is selected, the app fetches its file list from `/api/albums/{album}/files` and loads any visible `.gpx` files. Tracks render as a colored line with a black shadow underneath; waypoints render as colored circles with text labels. Each album gets a color from a rotating palette of 8.

Per-file visibility is controlled in the album files modal and persisted to `album_files` in `app.db`; hidden files are excluded from rendering. Implementation: `components/map-gpx/index.ts`.

## Photo Route

Displays a route connecting filtered album photos in chronological order. Only available when a specific album is selected (not "all albums").

### Route Display

When toggled on via the "Route" button in the filter panel, a blue line connects all filtered photos sorted by UTC time. If a saved route exists for the album (with custom waypoints or routing methods), it is loaded from the server. Otherwise, a default straight-line route is built from the filtered photos.

### Route Reconciliation

When a saved route is loaded (toggle-on or album switch), it is reconciled against the current album: photo points whose photos are no longer in the album (or have lost their location/date) are dropped, remaining points have their coordinates and chronological order refreshed, and photos newly added to the album are inserted at chronologically correct positions with straight-line segments. The reconciled route is persisted if its structure changed and no edits are pending.

Reconciliation runs at load time only — not on every photo edit while the route is hidden — so the file on disk may be briefly stale until the route is next opened. Custom routed segments (driving/hiking) split by an inserted point fall back to straight; the user can re-route them via the Edit UI.

### Route Editing

Activated via the "Edit" button (appears when route is visible). Crosshair cursor; the route renders with extra hit/hover layers for interaction.

**Operations:**

- **Add waypoint**: click a route segment to insert a waypoint at that position.
- **Remove waypoint**: click an existing waypoint to delete it. Photo points can't be removed.
- **Drag point**: mousedown + drag any point; adjacent segments update in real-time.
- **Change routing method**: right-click a segment to open a popup with method options.

**Routing methods** per segment: straight (default), driving (ORS driving-car), hiking (ORS foot-hiking), none (hidden segment). Driving/hiking entries hide when `PUBLIC_ORS_API_KEY` isn't set; on routing failure the segment downgrades to straight; waypoints can't be inserted on "none" segments.

Routes auto-save (1s debounce) via PUT `/api/albums/{album}/route`. Visibility persists via the `route` URL param. Exit edit with Escape, the "Edit" button again, or by switching to "all albums".

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

Top-right, 220px wide, collapsible (click the header to toggle). Implemented as `<filter-panel>`. Contents: item count, the filters described above, view-tool buttons (Fit, Reset, Measure, conditional Route/Edit/Files), Apple Maps / Google Maps deep links, and the pending-edits section.

Notable behaviours:

- **Reset** is broad — closes any popup, exits measure mode, resets filters / map style / marker style to defaults, clears and immediately persists all URL params, fits to all photos.
- **Fit** keeps current selection unless oldest or newest is open (toggles between them) or nothing is open (selects oldest).
- **Route**, **Edit**, **Files** are conditional — see `components/filter-panel/index.ts` for the visibility rules.

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
