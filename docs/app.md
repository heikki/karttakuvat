# App Specification

Karttakuvat displays geotagged photographs and videos on an interactive map. Items are exported from Apple Photos via Python scripts and served as static files. The dev server provides API endpoints for editing metadata back into Photos.app.

## Startup

1. Cache lightbox DOM elements, wire up metadata modal
2. Set up filter listeners (year, album, camera dropdowns + media/GPS toggle buttons + map type buttons)
3. Set up "Fit", "Reset", and save/discard edit buttons
4. Fetch `items.json`, sort by date, restore filters from URL or apply defaults
5. Restore map style from URL, create map with globe projection, register filter subscriber
6. On map load: add photo layers, add selection layer, set up marker interactions, add night layer, set up rectangular selection, load data, fit to all photos (skipped if map view restored from URL)
7. Populate year dropdown from data, cascade to album and camera dropdowns, apply filters
8. Restore selected photo from URL (reopen popup)
9. Stats update via subscriber

## Filters

Five filters that apply together, with cascading dependencies:

### Dropdowns (cascading)

- **Year**: populated from unique years. Changing year cascades to repopulate Album and Camera options.
- **Album**: populated from albums of photos matching the current year. Changing album cascades to repopulate Camera options.
- **Camera**: populated from cameras of photos matching current year + album.

### Toggle Buttons

- **Media**: Photos / Videos. Toggle buttons (active = included). Single-click toggles one button. Double-click solos that button (deactivates all others).
- **GPS precision**: Exif / Inferred / User / None. Same toggle/solo behavior. Color-coded to match marker colors (blue/amber/green/gray).

Changing any filter recomputes the filtered set and notifies:

1. Stats — updates count
2. Map — updates markers (only if style is fully loaded; changes during style transitions are silently dropped)

## Map

MapLibre GL JS with raster tile sources. Style switching via buttons:

- **Aerial** (default): Google Satellite
- **Topo**: Thunderforest Outdoors (requires API key)
- **Maasto**: MML Maastokartta over Thunderforest Outdoors (requires API keys)
- **Orto**: MML Ortokuva over Google Satellite (requires API key)

Selected map style is persisted in URL params (default `satellite` is omitted from URL). Style switching tears down and re-adds all layers after the new style loads.

### Projection

The map uses globe projection by default. A globe control (bottom-right) lets the user toggle between globe and mercator projections. When switching projection, the current popup is re-rendered at its position.

### Controls

- Navigation control (zoom +/-, compass) at bottom-right
- Globe control (projection toggle) at bottom-right
- Scale bar (metric) at bottom-left

### Marker Styles

Two switchable marker styles, selectable via buttons in the stats panel. The active marker style is persisted in URL params.

**Classic** (default): Color-coded circles by GPS type. Four layers:

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

Day/night shadow overlay rendered as a custom WebGL layer (part of the Points bloom layer). Uses subsolar point calculation to determine sun position. Visible only in globe projection. When navigating photos, the night layer animates to match the photo's date/time — fast transition (400ms) within a day, slower (2s) across large time gaps.

### Globe Background

Animated cosmic background (nebula + twinkling stars) rendered via a separate WebGL2 canvas behind the map. Two-pass rendering: expensive nebula texture rendered to FBO only when map is idle, cheap blit shader composites cached texture + live globe glow every frame. Visible only in globe projection. Pauses animation during map interaction to save GPU. Renders at half resolution, capped at 30fps.

Default center: Kuhmo, Finland (29.52, 64.13). Zoom 10. Box zoom, double-click zoom, and keyboard navigation disabled.

### Map Fitting

- **Initial load**: fit to all photos (skipped if map view is restored from URL)
- **"Fit" button**: fits to all filtered photos with animation, then opens popup on first photo
- **Padding**: top dynamic (350 in mercator; in globe: popup height + 60 or 50 if no popup), bottom 40, left 50, right 270 (accounts for stats panel)
- **Max zoom**: 18
- **Single point**: centers at zoom 14 instead of fitting bounds

### Auto-Pan

When a popup opens or navigates to a new photo, the map automatically pans to keep the popup fully visible within the viewport (with padding for the stats panel on the right).

### Marker Click

- Click marker: opens single-photo popup
- Click marker that belongs to current group popup: selects that photo within the group
- Click map background: closes popup (unless clicking on the selection rectangle)

## Placement Mode

Allows setting a photo's location by clicking on the map.

1. Activated via "set" button in popup location row
2. Closes any open popup
3. Shows placement panel (thumbnail + date + "Click map to set location" hint)
4. Changes cursor to crosshair
5. Hides all photo markers (markers stay hidden if map style is changed during placement)
6. Click on map: sets the location as a pending edit, exits placement mode, reopens popup at new location
7. Escape: cancels placement mode

## Selection

Shift+drag draws a rectangle on the map and selects enclosed markers.

1. Shift+mousedown: disables drag panning, records start point, clears previous selection
2. Mousemove: draws selection rectangle (blue fill 10% opacity + dashed blue outline)
3. Mouseup: re-enables drag panning, queries markers in the rectangle area
4. Minimum drag size: 10px in both axes — smaller drags are cancelled

**Result:**

- **0 markers**: selection cleared
- **1 marker**: selection cleared, single-photo popup at marker location
- **2+ markers**: selection rectangle stays visible. Multi-photo popup at top-center of selection. Map fits to selection bounds with padding for popup height. Selection clears when popup closes.

**Keyboard:** Escape closes popup and clears selection. Releasing Shift mid-drag cancels and clears.

## Popups

### Popup Behavior

- **Dynamic offset**: Popup is positioned above the marker with an offset based on the marker's visual radius at the current zoom level. Re-anchored on zoom changes.
- **Scroll zoom**: Mouse wheel on the popup or map canvas zooms around the selected marker (not the cursor), keeping the marker at the same screen position.
- **Pan-through**: Mouse drag on the popup (outside buttons, links, inputs, and thumb strip) is forwarded to the map canvas for panning.

### Single Photo

Shown on marker click or single-marker selection:

- Image wrap with thumbnail (click opens lightbox in all mode)
- Video indicator overlay (play icon) for video items
- Overlay buttons on image: info button (opens metadata modal), Photos.app link
- Date line with time adjustment controls:
  - Normal mode: formatted date + duration (for videos) + copy/paste/edit buttons
  - Edit mode: ±1d, ±1h buttons + done button + manual date input field
- Location line: formatted coordinates + set/copy/paste buttons
- Arrow keys navigate to next/prev photo in the filtered set (wrapping), moving the popup to each marker
- Closing clears marker highlight

### Multi-Photo

Shown after multi-marker selection:

- Count header (e.g. "45 photos - 3 videos") with date range
- Main image (click opens lightbox in group mode)
- Video indicator and overlay buttons (same as single)
- Date and location info for current photo (with edit controls)
- Scrollable thumbnail strip with video badges, active thumb has blue border
- Arrow keys navigate between photos in the group (wrapping)
- Switching photos updates the highlighted marker, video indicator, overlay buttons
- Photos sorted chronologically within group
- Closing clears selection rectangle and marker highlight

## Date/Time Editing

Available in both single and multi-photo popups:

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

- Edit section appears in stats panel showing count of pending edits
- **Save to Photos**: POST to `/api/set-locations`, reloads data, reopens current popup
- **Discard**: clears all pending edits

Pending edits are reflected immediately on the map (markers move to new positions) and in popups (dates show adjusted values).

## Lightbox

Full-screen overlay. Two modes:

- **All mode**: browse all filtered photos sequentially. Activated by clicking image in single popup.
- **Group mode**: browse only photos from current popup group. Activated by clicking image in multi-photo popup.

Controls: left/right arrows (click or keyboard), Space or backdrop click to close, Escape to close. Shows date with timezone, duration (for videos), coordinates, position counter (e.g. "3 of 45"), camera name overlay, and "Open in Photos" / info overlay buttons. Video items get a `.video` class on the lightbox.

## Metadata Modal

Full-screen overlay showing detailed photo metadata from Photos.app (via osxphotos).

- Activated by info button on popup or lightbox overlay
- Fetches from `/api/metadata/:uuid`
- Shows table of metadata fields: filename, dates, title, description, keywords, albums, persons, labels, AI caption, dimensions, file size, location, place, various flags (favorite, HDR, panorama, etc.), EXIF data, score, search info, UUID (with copy button)
- Empty/false fields are hidden
- Close with X button, backdrop click, or Escape
- Blocks all keyboard events except Escape while open

## Measurement Mode

Interactive distance measurement tool for measuring distances on the map.

1. Activated via "Measure" button in the stats panel view-buttons row
2. Cursor changes to crosshair
3. Click on map: adds a point, connected to previous points by a dashed red line
4. Distance overlay appears at top-center showing cumulative distance (meters below 1 km, kilometers with 2 decimals otherwise)
5. Click an existing measurement point: removes it from the path
6. Escape or click "Measure" button again: exits measurement mode and clears all points
7. "Reset" button also exits measurement mode

Measurement layers (points + line) are re-added after map style changes to persist across tile source switches.

## Stats Panel

Fixed top-right (220px wide). Collapsible — clicking the header toggles the panel body. Shows:

- Title "Karttakuvat" (clickable header to collapse/expand)
- Item count (photos and/or videos)
- Filter section: Year, Album, Camera dropdowns; Media and GPS toggle buttons; Map type buttons; Marker style buttons (Points/Classic)
- "Fit" button — fits map to filtered photos and opens popup on first photo
- "Reset" button — closes popup, clears selection, exits measure mode, resets all filters to defaults, resets map style to satellite, clears URL params, fits to all photos
- "Measure" button — toggles distance measurement mode (highlighted blue when active)
- "Apple Maps" button — opens Apple Maps at the current map center or selected photo location (satellite view)
- "Google Maps" button — opens Google Maps at the current map center or selected photo location
- Pending edits section (hidden when no edits): count + Save/Discard buttons

## URL State

App state is persisted in URL query parameters:

- **Filters**: `year`, `album`, `camera`, `gps` (comma-separated), `media` (comma-separated). Default values are omitted.
- **Photo**: `id` (UUID of currently viewed photo)
- **Map view**: `lat`, `lon`, `z` (zoom) — updated on every map move
- **Map style**: `style` (e.g. `topo`, `mml_maastokartta`). Default `satellite` is omitted.
- **Marker style**: `markers` (e.g. `classic`). Default `points` is omitted.

On startup, saved URL state is restored: filters are applied, map view is positioned, map style is set, and the selected photo popup is reopened. The Reset button clears all URL params.

## Keyboard Shortcuts

| Key        | Context             | Action                          |
| ---------- | ------------------- | ------------------------------- |
| Escape     | Metadata modal open | Close metadata modal            |
| Escape     | Date edit mode      | Exit date edit mode             |
| Escape     | Measure mode        | Exit measurement mode           |
| Escape     | Placement mode      | Cancel placement mode           |
| Escape     | Lightbox open       | Close lightbox                  |
| Escape     | Popup open          | Close popup and clear selection |
| Space      | Lightbox open       | Close lightbox                  |
| Space      | Group popup open    | Open lightbox in group mode     |
| Space      | Single popup open   | Open lightbox in all mode       |
| Left/Right | Lightbox open       | Navigate photos                 |
| Left/Right | Popup open          | Navigate photos (group or all)  |
| Shift+drag | Map                 | Rectangular selection           |
| Enter      | Date input focused  | Apply manual date               |
