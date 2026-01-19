# Karttakuvat

Geolocation photo visualization web app displaying geotagged photographs on an interactive map.

## Project Structure

```
├── src/
│   ├── index.ts        # Main application logic (TypeScript)
│   └── index.html      # Entry point HTML
├── public/             # Static assets (served at root)
│   ├── photos.json     # Photo metadata
│   ├── full/           # Full-size photos
│   └── thumb/          # Thumbnails
├── scripts/            # Python data export scripts
├── server.ts           # Bun dev server
├── eslint.config.js    # Linting config
├── prettier.config.js  # Formatting config
└── tsconfig.json       # TypeScript config
```

## Tech Stack

- **Runtime/Bundler**: Bun
- **Language**: TypeScript
- **Map Library**: MapLibre GL JS (bundled)
- **Styling**: Vanilla CSS (in `src/index.html`)

## Commands

- `bun dev`: Start dev server (Hot Reloading)
- `bun run build`: Build for production (`dist/`)
- `bun run lint`: Run ESLint
- `bun run format`: Run Prettier

## Data Format

`public/photos.json` entries:
```json
{
  "uuid": "...",
  "full": "full/ID.jpg",
  "thumb": "thumb/ID.jpg",
  "lat": 69.04,
  "lon": 20.80,
  "date": "2008:07:09 17:53:13",
  "gps": "inferred|exif|user",
  "albums": ["Name"],
  "photos_url": "photos:albums?..."
}
```

## Scripts

Requires `osxphotos` (`pipx install osxphotos`), `Pillow`.

```bash
python3 scripts/export_photos.py              # Export to public/
python3 scripts/sync_metadata.py              # Sync json metadata
```
