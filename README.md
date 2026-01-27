# Karttakuvat

Geolocation photo visualization web app. Displays geotagged photographs on an interactive map.

## Setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Run dev server:
   ```bash
   bun dev
   ```
   Open http://localhost:3000

## Build

```bash
bun run build
```

## Data Pipeline

Export photos from Apple Photos using scripts in `scripts/`. Requires `osxphotos` and `Pillow`.

```bash
python3 scripts/export_photos.py    # Full export to public/
python3 scripts/sync_metadata.py    # Sync metadata in photos.json
```

## Docs

- [App spec](docs/app.md) — current behavior
- [User flows](docs/flows.md) — interaction flows
- [Timeline plan](docs/timeline.md) — upcoming features
