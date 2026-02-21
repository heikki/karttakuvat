# Karttakuvat

Geolocation photo visualization web app displaying geotagged photographs on an interactive map.

## Tech Stack

- **Runtime/Bundler**: Bun
- **Language**: TypeScript
- **Map Library**: MapLibre GL JS (bundled)
- **Styling**: Vanilla CSS

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

## Docs

- `docs/app.md` — current app behavior spec
- `docs/flows.md` — user interaction flows
- `docs/diary.md` — development diary and project stats
- `docs/phase4-native-bindings.md` — native ObjC bindings plan
