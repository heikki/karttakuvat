# Karttakuvat

Geolocation photo visualization web app displaying geotagged photographs on an interactive map.

## Project Structure

```
├── index.html          # Single-file web app (HTML + CSS + JS)
├── photos.json         # Photo metadata (3,629 entries)
├── full/               # Full-size photo assets
├── thumb/              # Thumbnail images
└── scripts/
    ├── export_photos.py    # Export photos from Apple Photos
    ├── export_videos.py    # Export videos (WIP)
    └── sync_metadata.py    # Sync metadata without re-exporting
```

## Tech Stack

- **Vanilla HTML/CSS/JavaScript** - No build tools or framework
- **MapLibre GL JS 4.7** - WebGL map with smooth zoom (CDN)
- **Multiple tile sources** - OpenTopoMap, Esri Satellite, OSM, CyclOSM

## Running Locally

No build step required. Serve with:

```bash
bunx serve
```

## Data Format

`photos.json` contains entries with:
```json
{
  "uuid": "266A013D-41FC-49CE-8BA4-62D94D65CEF5",
  "full": "full/266A013D-41FC-49CE-8BA4-62D94D65CEF5.jpg",
  "thumb": "thumb/266A013D-41FC-49CE-8BA4-62D94D65CEF5.jpg",
  "lat": 69.0443084,
  "lon": 20.8032964,
  "date": "2008:07:09 17:53:13",
  "gps": "inferred",
  "albums": ["2008 Halti"],
  "photos_url": "photos:albums?albumUuid=...&assetUuid=..."
}
```

- `gps`: Source of coordinates - `exif` (from image metadata), `inferred` (from album/context), or `user` (manually set/modified)
- `albums`: Array of album names the photo belongs to
- `photos_url`: Deep link to open photo in Apple Photos

## Key Features

- Distance-based color coding (green <5km, blue 5-20km, amber 20-35km, red 35-50km)
- Year filter dropdown
- Map type switcher (OpenTopoMap, Satellite, OSM, CyclOSM)
- Photo popups with previews
- Full-screen lightbox with keyboard navigation (arrows, Escape)
- Stats panel showing photo count and date range

## Scripts

Requires `osxphotos` (`pipx install osxphotos`), `Pillow`, and Full Disk Access for Terminal.

```bash
python3 scripts/export_photos.py              # Incremental export (new photos only)
python3 scripts/export_photos.py --full       # Full re-export
python3 scripts/export_photos.py --album "X"  # Filter by album

python3 scripts/sync_metadata.py              # Update photos.json from Photos app
                                              # (coordinates, albums) without re-exporting
```

## Architecture Notes

- All logic in single `index.html` file
- No external dependencies beyond CDN libraries
