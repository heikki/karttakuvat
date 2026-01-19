# Karttakuvat

Geolocation photo visualization web app. Displays geotagged photographs on an interactive map.

## Setup

1.  Install dependencies:

    ```bash
    bun install
    ```

2.  Run dev server:
    ```bash
    bun dev
    ```
    Open http://localhost:3000

## Build

To build for production:

```bash
bun run build
```

## Structure

- `src/`: Source code (`index.ts`, `index.html`)
- `public/`: Static assets (`photos.json`, `full/`, `thumb/`)
- `scripts/`: Python scripts for data export
- `server.ts`: Bun dev server

## Data Pipeline

See `scripts/` directory for Python scripts to export photos from Apple Photos.
