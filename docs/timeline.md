# Timeline & Route Feature Plan

## Overview

Add an interactive timeline UI that allows users to visualize and filter photos by date, combined with route/trip visualization that connects photos chronologically on the map.

## Current State

- Items have `date` field in format `"YYYY:MM:DD HH:MM:SS"` with optional `tz` timezone offset
- Filters: year/album/camera dropdowns (cascading), media/GPS toggle buttons
- Items sorted by date in `items.json` (photos and videos)
- Date range shown in stats panel
- `formatDate()` handles dates with timezone display
- `compareDates()` sorts by UTC using timezone offsets
- Albums already in data, used for album filter
- Camera info already in data, used for camera filter
- Date/time editing already works (copy/paste/adjust/manual entry via popups)
- Location editing already works (placement mode, copy/paste)

---

## Feature 1: Timeline Bar

### Design: Horizontal Timeline Bar

A scrubable bar at the bottom of the screen showing photo density over time.

**Visual:**

```
[=========|||||||||===|||=======|||||||=========]
2013                 2018                    2025
      ^ drag handles for range selection ^
```

**Features:**

- Bar chart showing photo count per month/year
- Draggable range handles to filter date range
- Click to jump to specific date
- Shows date range as you drag
- Replaces existing year dropdown

---

## Feature 2: Route/Trip View

### Concept

Trips are user-defined collections (matching Apple Photos albums like "2018 Kuhmo"). When a trip is selected, draw lines connecting photos in chronological order to show the travel route.

**Visual:**

```
     [Photo 1] -----> [Photo 2]
         9:00am          9:45am
                \
                 \-----> [Photo 3]
                          10:30am
```

### Trip Data Source

Trips come from Apple Photos albums, exported via `osxphotos`:

```json
// In items.json, each item includes albums, camera, type, timezone
{
  "uuid": "ABC123",
  "type": "photo",
  "albums": ["2018 Kuhmo", "Favorites"],
  "camera": "iPhone 12",
  "lat": 64.13,
  "lon": 29.52,
  "date": "2018:07:15 09:00:00",
  "tz": "+03:00"
}
```

### Trip Selection UI

- Dropdown in stats panel: "Select Trip"
- Lists all albums that have geotagged photos
- Selecting a trip:
  1. Filters photos to that album
  2. Fits map to those photos
  3. Draws route connecting them chronologically
  4. Timeline zooms to trip date range

### Timeline + Trip Integration

When a trip is selected:

- Timeline auto-zooms to the trip's date range (handles snap to trip bounds)
- Rest of timeline outside trip range is grayed out / de-emphasized
- Trip's date range highlighted with accent color band
- Shows trip in context of all photos (can see where it falls in overall history)
- "Clear" button resets to all photos view

```
All photos:
[====|||||====||||||||||===|||====||||=====]
2013         2018              2022    2025

Trip "2018 Kuhmo" selected:
[░░░░░░░░░░░░░|||||░░░░░░░░░░░░░░░░░░░░░░░░]
              ▲▲▲▲▲
          Jul 15-20 (zoomed + highlighted)
```

### Route Display

**Within a trip:**

- Connect all photos chronologically with a line
- Different color for each day within the trip
- Dashed line for overnight gaps (>8 hours)

### Route Styling

```css
.route-line {
  stroke: #007aff;
  stroke-width: 3;
  stroke-opacity: 0.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.route-line-day-1 {
  stroke: #007aff;
} /* Blue */
.route-line-day-2 {
  stroke: #34c759;
} /* Green */
.route-line-day-3 {
  stroke: #ff9500;
} /* Orange */
```

### Data Structures

```javascript
// Trip (from album)
const trips = [
  { name: '2018 Kuhmo', photoCount: 45, dateRange: 'Jul 15-20, 2018' },
  { name: '2019 Summer', photoCount: 120, dateRange: 'Jun-Aug 2019' }
  // ...
];

// Route segments for selected trip
const routeSegments = [
  {
    date: '2018-07-15',
    points: [
      { lat, lon, time: '09:00', photoIndex: 0 },
      { lat, lon, time: '09:45', photoIndex: 1 }
      // ...
    ]
  }
  // ... more days
];
```

---

## Feature 3: Playback/Animation Mode

Animate through photos chronologically like a slideshow with map panning and route drawing.

**Features:**

- Play button starts animation
- Speed control slider
- Map pans smoothly to each photo location
- Route line draws progressively as animation plays
- Timeline shows current position
- Pause/resume support

**Animation Flow:**

1. Start at first photo in range
2. Pan map to photo location
3. Show photo popup briefly
4. Draw line segment to next photo
5. Repeat until end of range

---

## Combined UI Mockup

```
┌─────────────────────────────────────────────────────────┐
│                         MAP                             │
│                                             ┌─────────┐ │
│      [1]───────[2]                          │ Stats   │ │
│                 \                           │ Panel   │ │
│                  \───[3]────[4]             │         │ │
│                              │              │ Trip:   │ │
│                             [5]             │ [2018 ▾]│ │
│                                             └─────────┘ │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ ▶ ⏸ [======|||||||====||||||=========]  Jul 2018 │  │
│  │  1x    Jul 15 ──────────── Jul 20                │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Timeline Bar

1. Build timeline data (group photos by month)
2. Render histogram with Canvas/SVG
3. Add draggable range handles
4. Connect to photo filtering

### Phase 2: Trip/Route Visualization

1. Create `sync_metadata.py` for fast metadata updates (albums, location, date)
2. Add trip dropdown to stats panel
3. Add MapLibre line layer for routes
4. Generate route from trip photos (grouped by day)
5. Style lines with day-based colors

### Phase 3: Playback Animation

1. Add play/pause controls to timeline
2. Implement animation loop with requestAnimationFrame
3. Smooth map panning between photos
4. Progressive route line drawing
5. Speed control slider

---

## Technical Details

### MapLibre Route Layer

```javascript
map.addSource('route', {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] }
});

map.addLayer({
  id: 'route-line',
  type: 'line',
  source: 'route',
  paint: {
    'line-color': ['get', 'color'],
    'line-width': 3,
    'line-opacity': 0.7
  }
});
```

### Export Scripts

Two scripts already exist:

**`scripts/export.py`** (full export, slow)

- Exports full images/videos and thumbnails to `public/`
- Builds `items.json` with all metadata (albums, camera, type, timezone, etc.)
- Run when adding new photos
- Takes minutes to run

**`scripts/sync.py`** (metadata sync, fast)

- Updates metadata in `items.json` without re-exporting images
- Queries Photos library for current metadata
- Run after editing metadata in Photos
- Takes seconds to run

Additional server-side scripts called by APIs:

- **`scripts/set_locations.py`** — sets photo locations in Photos.app (called by `/api/save-edits`)
- **`scripts/set_times.py`** — sets photo dates in Photos.app (called by `/api/save-edits`)

### Route Generation Function

```javascript
function generateRouteGeoJSON(photos) {
  // Group by day, connect within each day
  const byDay = groupByDay(photos);
  const features = [];
  const colors = ['#007AFF', '#34C759', '#FF9500', '#FF2D55', '#AF52DE'];

  byDay.forEach((dayPhotos, i) => {
    if (dayPhotos.length < 2) return;

    const coords = dayPhotos.map((p) => [p.lon, p.lat]);
    features.push({
      type: 'Feature',
      properties: { color: colors[i % colors.length], day: i + 1 },
      geometry: { type: 'LineString', coordinates: coords }
    });
  });

  return { type: 'FeatureCollection', features };
}
```

### Timeline CSS

```css
.timeline-container {
  position: absolute;
  bottom: 20px;
  left: 20px;
  right: 270px; /* Account for stats panel */
  height: 70px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  display: flex;
  align-items: center;
  padding: 0 15px;
  gap: 10px;
}

.timeline-controls {
  display: flex;
  gap: 5px;
}

.timeline-controls button {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: #007aff;
  color: white;
  cursor: pointer;
}

.timeline-histogram {
  flex: 1;
  height: 40px;
  position: relative;
}

.timeline-range {
  font-size: 12px;
  color: #666;
  white-space: nowrap;
}
```

---

## Considerations

1. **Performance**: Large trips may have many line segments - use simplification
2. **Mobile**: Timeline collapses to minimal view, trip selector in menu
3. **Colors**: Use colorblind-friendly palette for multi-day routes
4. **Album naming**: Trips are identified by album name pattern (could filter to "YYYY\*" pattern)
5. **No album**: Photos without albums still show on map but aren't part of any trip

## Files to Modify

- `src/lib/` — new module(s) for timeline and route logic
- `src/index.ts` — wire up new UI components
- `src/index.html` — add timeline container and trip UI elements
- `src/styles/main.css` — timeline and route styles
