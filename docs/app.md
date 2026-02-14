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

- **Topo** (default): OpenTopoMap
- **Satellite**: Esri World Imagery
- **Maasto**: MML Maastokartta (requires API key)
- **Orto**: MML Ortokuva (requires API key)

Selected map style is persisted in URL params (default Topo is omitted from URL). Style switching tears down and re-adds all layers after the new style is idle.

### Projection

The map uses globe projection by default. A globe control (bottom-right) lets the user toggle between globe and mercator projections. When switching projection, the current popup is re-rendered at its position.

### Controls

- Navigation control (zoom +/-, compass) at bottom-right
- Globe control (projection toggle) at bottom-right
- Scale bar (metric) at bottom-left

### Layers

Three circle layers on a single GeoJSON source:

- **Markers** (`photo-markers`): Color-coded by GPS type:
  - Blue (`#3b82f6`): exif
  - Amber (`#f59e0b`): inferred
  - Green (`#22c55e`): user
  - Gray (`#9ca3af`): none
  - Radius 8, white stroke width 2. Sorted by latitude (northern behind southern) then index.

- **Selected marker** (`photo-markers-selected`): Same paint as markers. Shown via filter on index. Drawn above regular markers.

- **Highlight ring** (`photo-markers-highlight-ring`): Pulsing animation — blue stroke ring that grows from radius 12 to 20 while fading from 0.8 to 0 opacity over 1.2s, repeating. Shown via filter on index.

- **Night layer**: Day/night shadow overlay using `maplibre-gl-nightlayer`. Visible only in globe projection (opacity 0 in mercator). When navigating photos, the night layer animates to match the photo's date/time — fast transition (400ms) within an album, slower (2s) across large time gaps. Reset button clears the night layer to current time.

Default center: Kuhmo, Finland (29.52, 64.13). Zoom 10. Box zoom and keyboard navigation disabled.

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
5. Hides all photo markers
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

## Stats Panel

Fixed top-right (220px wide). Shows:

- Title "Karttakuvat"
- Item count (photos and/or videos)
- Filter section: Year, Album, Camera dropdowns; Media and GPS toggle buttons; Map type buttons
- "Fit" button — fits map to filtered photos and opens popup on first photo
- "Reset" button — closes popup, clears selection, resets night layer, resets all filters to defaults, clears URL params, fits to all photos
- Pending edits section (hidden when no edits): count + Save/Discard buttons

## URL State

App state is persisted in URL query parameters:

- **Filters**: `year`, `album`, `camera`, `gps` (comma-separated), `media` (comma-separated). Default values are omitted.
- **Photo**: `id` (UUID of currently viewed photo)
- **Map view**: `lat`, `lon`, `z` (zoom) — updated on every map move
- **Map style**: `style` (e.g. `satellite`, `mml_maastokartta`). Default `opentopomap` is omitted.

On startup, saved URL state is restored: filters are applied, map view is positioned, map style is set, and the selected photo popup is reopened. The Reset button clears all URL params.

## Keyboard Shortcuts

| Key        | Context             | Action                          |
| ---------- | ------------------- | ------------------------------- |
| Escape     | Metadata modal open | Close metadata modal            |
| Escape     | Date edit mode      | Exit date edit mode             |
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
