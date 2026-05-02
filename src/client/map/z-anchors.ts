import type { Map as MapGL } from 'maplibre-gl';

export const Z_BANDS = ['gpx', 'route', 'markers', 'measure'] as const;
export type ZBand = (typeof Z_BANDS)[number];

const SOURCE = 'z-empty';

export function anchorId(band: ZBand): string {
  return `z-${band}`;
}

export function initZAnchors(map: MapGL): void {
  map.on('load', () => {
    if (map.getSource(SOURCE) === undefined) {
      map.addSource(SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    for (let i = Z_BANDS.length - 1; i >= 0; i--) {
      const id = anchorId(Z_BANDS[i]!);
      if (map.getLayer(id) !== undefined) continue;
      const before =
        i < Z_BANDS.length - 1 ? anchorId(Z_BANDS[i + 1]!) : undefined;
      map.addLayer({ id, type: 'symbol', source: SOURCE }, before);
    }
  });
}
