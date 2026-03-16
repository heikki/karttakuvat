# Karttakuvat

Geolocation photo visualization app. Displays geotagged photographs from Apple Photos on an interactive map.

![Karttakuvat](screenshot.png)

## Setup

Requires macOS, [Bun](https://bun.sh/), and Apple Photos with geotagged photos. API keys for [MML](https://www.maanmittauslaitos.fi/rajapinnat/api-avaimen-ohje) and [OpenRouteService](https://openrouteservice.org/) are needed in `.env`:

```
PUBLIC_MML_API_KEY=your-key
PUBLIC_ORS_API_KEY=your-key
```

```bash
bun install
bun dev
```

To build and install to `/Applications`:

```bash
bun install:app
```

## Docs

- [App spec](docs/app.md) — current behavior
- [User flows](docs/flows.md) — interaction flows
- [Development diary](docs/diary.md) — project stats
