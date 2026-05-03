import type { Map as MapGL } from 'maplibre-gl';

const BANDS = ['gpx', 'route', 'markers', 'measure'] as const;
export type ZBand = (typeof BANDS)[number];

const SOURCE = 'z-empty';

function id(band: ZBand): string {
  return `z-${band}`;
}

function init(map: MapGL): void {
  map.on('load', () => {
    if (map.getSource(SOURCE) === undefined) {
      map.addSource(SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    for (let i = BANDS.length - 1; i >= 0; i--) {
      const layerId = id(BANDS[i]!);
      if (map.getLayer(layerId) !== undefined) continue;
      const before = i < BANDS.length - 1 ? id(BANDS[i + 1]!) : undefined;
      map.addLayer({ id: layerId, type: 'symbol', source: SOURCE }, before);
    }
  });
}

export default { BANDS, id, init };
