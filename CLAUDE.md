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
│   ├── index.ts           # Entry point, wiring
│   ├── index.html         # Shell HTML
│   ├── styles/main.css    # All styles
│   └── lib/
│       ├── types.ts       # Photo, MapStyle interfaces
│       ├── config.ts      # Map tile source definitions
│       ├── data.ts        # State, data loading, filtering, pub/sub
│       ├── utils.ts       # Date formatting, URL helpers
│       ├── map.ts         # MapLibre init, layers, marker interactions
│       ├── popup.ts       # Single and multi-photo map popups
│       ├── selection.ts   # Shift+drag rectangular selection
│       └── ui.ts          # Lightbox, stats panel, year filter
├── public/                # Static assets (served at root)
│   ├── photos.json        # Photo metadata
│   ├── full/              # Full-size photos
│   └── thumb/             # Thumbnails
├── scripts/               # Python data export scripts
├── server.ts              # Bun dev server
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

`public/photos.json` entries:

```json
{
  "uuid": "...",
  "full": "full/ID.jpg",
  "thumb": "thumb/ID.jpg",
  "lat": 69.04,
  "lon": 20.8,
  "date": "2008:07:09 17:53:13",
  "gps": "inferred|exif|user",
  "albums": ["Name"],
  "photos_url": "photos:albums?..."
}
```

## Scripts

Requires `osxphotos` (`pipx install osxphotos`), `Pillow`.

```bash
python3 scripts/export_photos.py    # Full export to public/
python3 scripts/sync_metadata.py    # Sync metadata in photos.json
```

## Docs

- `docs/app.md` — current app behavior spec
- `docs/flows.md` — user interaction flows
- `docs/timeline.md` — timeline & route feature plan
