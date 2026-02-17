# Karttakuvat

Geolocation photo visualization web app displaying geotagged photographs on an interactive map.

## Tech Stack

- **Runtime/Bundler**: Bun
- **Language**: TypeScript
- **Map Library**: MapLibre GL JS (bundled)
- **Styling**: Vanilla CSS

## Project Structure

```
├── src/
│   ├── index.ts           # Entry point, wiring, metadata modal, filter cascading
│   ├── index.html         # Shell HTML
│   ├── styles/main.css    # All styles
│   └── lib/
│       ├── types.ts       # Photo, MapStyle, MarkerLayer interfaces
│       ├── config.ts      # Map tile source definitions
│       ├── data.ts        # State, data loading, filtering, pub/sub, pending edits
│       ├── utils.ts       # Date formatting, URL helpers, date parsing
│       ├── filter-url.ts  # URL state persistence (filters, map view, style, marker style, photo)
│       ├── map.ts         # MapLibre init, marker layer management, marker interactions
│       ├── fit.ts         # Map fitting logic (fit to photos, padding)
│       ├── pan.ts         # Auto-pan map to keep popup visible
│       ├── placement.ts   # Placement mode (set photo location by clicking map)
│       ├── globe-background.ts  # WebGL2 animated nebula/stars background for globe
│       ├── popup/
│       │   ├── index.ts   # Popup state, navigation, date/location editing logic
│       │   ├── html.ts    # Popup HTML generation, overlay buttons
│       │   └── zoom.ts    # Wheel zoom around popup marker
│       ├── measure.ts     # Distance measurement tool
│       ├── metadata.ts    # Metadata modal (osxphotos detail view)
│       ├── selection.ts   # Shift+drag rectangular selection, arrow key navigation
│       ├── ui.ts          # Lightbox, stats panel, filter UI helpers
│       ├── classic-layer/
│       │   └── index.ts   # Classic marker style (color-coded circles by GPS type)
│       └── points-layer/
│           ├── index.ts   # Points marker style (white dots with WebGL bloom)
│           ├── bloom.ts   # Custom WebGL layer: bloom glow + night shadow
│           ├── night.ts   # Subsolar point calculation, night transition animation
│           ├── shaders.ts # GLSL shaders for points, blur, composite, night
│           └── gl-utils.ts # WebGL framebuffer/mip helpers
├── public/                # Static assets (served at root)
│   ├── items.json         # Photo/video metadata
│   ├── full/              # Full-size photos/videos
│   └── thumb/             # Thumbnails
├── scripts/               # Python scripts for Photos.app integration
├── server.ts              # Bun dev server with API endpoints
├── docs/                  # Specs and plans
├── eslint.config.js
├── prettier.config.js
└── tsconfig.json
```

## Commands

- `bun dev` — dev server with hot reload
- `bun run build` — production build to `dist/`
- `bun run lint` — ESLint
- `bun run format` — Prettier

## Data Format

`public/items.json` entries:

```json
{
  "uuid": "...",
  "type": "photo|video",
  "full": "full/ID.jpg",
  "thumb": "thumb/ID.jpg",
  "lat": 69.04,
  "lon": 20.8,
  "date": "2008:07:09 17:53:13",
  "tz": "+03:00",
  "camera": "Canon PowerShot A720 IS",
  "gps": "exif|inferred|user",
  "gps_accuracy": 1,
  "albums": ["2008 Halti"],
  "photos_url": "photos:albums?...",
  "duration": "0:30"
}
```

## Scripts

Requires `osxphotos` (`pipx install osxphotos`), `Pillow`.

```bash
python3 scripts/export.py           # Full export from Photos.app to public/
python3 scripts/sync.py             # Sync metadata in items.json from Photos.app
python3 scripts/set_locations.py    # Set photo locations (called by server)
python3 scripts/set_times.py        # Set photo dates (called by server)
python3 scripts/set_cameras.py      # Copy camera EXIF to photos missing it
python3 scripts/sync_timezones.py   # Sync timezone data
```

## Server API

The dev server (`server.ts`) exposes:

- `POST /api/save-edits` — Save pending location and time edits to Photos.app
- `GET /api/metadata/:uuid` — Fetch full osxphotos metadata for a photo

## Docs

- `docs/app.md` — current app behavior spec
- `docs/flows.md` — user interaction flows
- `docs/timeline.md` — timeline & route feature plan
