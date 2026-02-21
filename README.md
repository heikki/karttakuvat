# Karttakuvat

Geolocation photo visualization app. Displays geotagged photographs from Apple Photos on an interactive map.

## Setup

```bash
bun install
bun build:native    # compile native ObjC++ dylib (required before first run)
```

## Development

```bash
bun dev             # standalone dev server with hot reload
bun dev:app         # Electrobun app (dev build)
```

## Build

```bash
bun build:app           # dev Electrobun build
bun build:app:stable    # stable Electrobun build
bun install:app         # build stable + install to /Applications
```

## Docs

- [App spec](docs/app.md) — current behavior
- [User flows](docs/flows.md) — interaction flows
- [Development diary](docs/diary.md) — project stats
