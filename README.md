# Karttakuvat

Globe view of an Apple Photos library — fix missing locations and wrong dates or timezones in place.

Photos and videos can be browsed in a built-in full-screen lightbox.

![Karttakuvat](screenshot.png)

## Setup

Requires macOS, [Bun](https://bun.sh/), and Apple Photos with geotagged photos.

```bash
bun install
bun dev
```

To build and install to `/Applications`:

```bash
bun install:app
```

### Optional API keys

Add either to `.env` to unlock extra features. Both are optional.

```
PUBLIC_MML_API_KEY=your-key   # MML — Maasto/Orto basemaps
PUBLIC_ORS_API_KEY=your-key   # OpenRouteService — Drive/Hike routing
```

Get keys from [MML](https://www.maanmittauslaitos.fi/rajapinnat/api-avaimen-ohje) and [OpenRouteService](https://openrouteservice.org/).

## Docs

- [App spec](docs/app.md) — current behavior
- [User flows](docs/flows.md) — interaction flows
- [Development diary](docs/diary.md) — project stats
