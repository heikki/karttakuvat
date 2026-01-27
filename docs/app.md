# App Specification

Karttakuvat displays geotagged photographs on an interactive map. Photos are exported from Apple Photos via Python scripts and served as static files.

## Startup

1. Cache lightbox DOM elements, wire up filter and stats listeners
2. Fetch `photos.json`, sort by date, apply default filters — stats update but map not yet ready
3. Create map, register map's filter subscriber
4. On map load: add layers, add selection layer, set up interactions, load data, unconditionally fit to all photos
5. Populate year dropdown from data

## Filters

Two dropdowns that apply together:

- **Year**: populated from unique years in the dataset
- **GPS precision**: all / exif / inferred / user

Changing either filter recomputes the filtered photo set and notifies:

1. Stats — updates photo count and date range display
2. Map — updates markers, but **only if the map style is fully loaded**. Filter changes during a style transition are silently dropped.

## Map

MapLibre GL JS with raster tile sources (OpenTopoMap default, Esri Satellite, OSM, CyclOSM). Style switching tears down and re-adds all layers after the new style is idle.

Three circle layers on a single GeoJSON source:

- **Markers** — blue circles (r=8, white stroke). Sorted by latitude (northern behind southern).
- **Highlight** — amber circle (r=10) for the selected photo. Shown via filter expression on index.
- **Highlight ring** — blue stroke ring (r=18) around highlighted marker.

Default center: Kuhmo, Finland. Zoom 10.

### Map Fitting

- **Initial load**: unconditional fit to all photos
- **Filter change**: only re-fits if some filtered photos are outside the current view. Narrowing a filter won't zoom in if photos are already visible.
- **Style change**: same conditional fit after layers are re-added
- **Padding**: top 20, bottom 150, left 20, right 270 (accounts for stats panel)

### Marker Click

- Click marker: opens single-photo popup
- Click map background: closes popup (unless clicking on the selection rectangle)

## Selection

Shift+drag draws a rectangle on the map and selects enclosed markers.

1. Shift+mousedown: disables drag panning, records start point, clears previous selection
2. Mousemove: draws selection rectangle (blue fill + dashed outline)
3. Mouseup: re-enables drag panning, queries markers in the rectangle area
4. Minimum drag size: 10px in both axes — smaller drags are cancelled

**Result:**

- **0 markers**: selection cleared
- **1 marker**: selection cleared immediately, single-photo popup at marker location
- **2+ markers**: selection rectangle stays visible. Multi-photo popup at top-center of selection. Map fits to selection bounds with padding for popup height. Selection clears when popup closes.

**Keyboard:** Escape closes popup and clears selection. Releasing Shift mid-drag cancels and clears.

## Popups

### Single Photo

Shown on marker click or single-marker selection:

- Thumbnail (click opens lightbox in all mode)
- Date and coordinates
- "Open in Photos" link when available
- Closing clears marker highlight

### Multi-Photo

Shown after multi-marker selection:

- Photo count and date range header
- Main image (click opens lightbox in group mode)
- Scrollable thumbnail strip, active thumb has blue border
- Arrow keys navigate between photos in the group
- Switching photos updates the highlighted marker
- Photos sorted chronologically within group
- Closing clears selection rectangle and marker highlight

## Lightbox

Full-screen overlay. Two modes:

- **All mode**: browse all filtered photos sequentially. Activated by clicking photo count in stats panel.
- **Group mode**: browse only photos from current popup group. Activated by clicking image in a popup.

Controls: left/right arrows (click or keyboard), Escape or backdrop click to close. Shows date, coordinates, position counter, and "Open in Photos" link.

## Stats Panel

Fixed top-right. Shows:

- Photo count (clickable — opens lightbox in all mode)
- Date range of filtered photos
- "Shift+drag to select area" hint
- Filter dropdowns (year, GPS precision, map type)
