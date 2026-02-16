import type { FeatureCollection, Point } from 'geojson';
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapGL
} from 'maplibre-gl';

import { getEffectiveCoords } from '../data';
import type { MarkerLayer, Photo } from '../types';
import { BloomLayer } from './bloom';

const hitAreaPaint: CircleLayerSpecification['paint'] = {
  'circle-color': 'transparent',
  'circle-radius': [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    4,
    6,
    8,
    10,
    12,
    16,
    16,
    22,
    20,
    30
  ],
  'circle-opacity': 0,
  'circle-pitch-alignment': 'map'
};

const dotPaint: CircleLayerSpecification['paint'] = {
  'circle-color': '#ffffff',
  'circle-radius': [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    4,
    1,
    8,
    2,
    12,
    3,
    16,
    5,
    20,
    7
  ],
  'circle-opacity': 1,
  'circle-blur': 0.4,
  'circle-pitch-alignment': 'map'
};

const sortKey = [
  '-',
  ['*', -1000000, ['get', 'lat']],
  ['get', 'index']
] as ExpressionSpecification;

const SOURCE = 'points-source';
const LAYERS = ['points-markers', 'points-dot', 'points-selected'] as const;

export class PointsLayer implements MarkerLayer {
  readonly id = 'points-markers';
  private readonly bloom = new BloomLayer();
  private map: MapGL | null = null;

  install(map: MapGL) {
    this.map = map;

    map.addLayer(this.bloom);

    map.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'points-markers',
      type: 'circle',
      source: SOURCE,
      layout: { 'circle-sort-key': sortKey },
      paint: hitAreaPaint
    });

    map.addLayer({
      id: 'points-dot',
      type: 'circle',
      source: SOURCE,
      layout: { 'circle-sort-key': sortKey },
      paint: dotPaint
    });

    map.addLayer({
      id: 'points-selected',
      type: 'circle',
      source: SOURCE,
      paint: hitAreaPaint,
      filter: ['==', ['get', 'uuid'], '']
    });
  }

  uninstall() {
    if (this.map === null) return;
    for (let i = LAYERS.length - 1; i >= 0; i--) {
      if (this.map.getLayer(LAYERS[i]!) !== undefined) {
        this.map.removeLayer(LAYERS[i]!);
      }
    }
    if (this.map.getLayer(this.bloom.id) !== undefined) {
      this.map.removeLayer(this.bloom.id);
    }
    if (this.map.getSource(SOURCE) !== undefined) this.map.removeSource(SOURCE);
    this.map = null;
  }

  toggle(visible: boolean) {
    if (this.map === null) return;
    const v = visible ? 'visible' : 'none';
    for (const id of LAYERS) {
      if (this.map.getLayer(id) !== undefined) {
        this.map.setLayoutProperty(id, 'visibility', v);
      }
    }
    if (this.map.getLayer(this.bloom.id) !== undefined) {
      this.map.setLayoutProperty(this.bloom.id, 'visibility', v);
    }
  }

  highlight(photo: Photo | null) {
    if (this.map === null) return;
    const filter: FilterSpecification =
      photo === null
        ? ['==', ['get', 'uuid'], '']
        : ['==', ['get', 'uuid'], photo.uuid];
    if (this.map.getLayer('points-selected') !== undefined) {
      this.map.setFilter('points-selected', filter);
    }
    if (photo === null) {
      this.bloom.setTime('', null);
    } else {
      this.bloom.setTime(photo.date, photo.tz ?? null);
    }
  }

  setMarkers(photos: Photo[]) {
    if (this.map === null) return;

    const geojson = buildGeoJSON(photos);
    const source = this.map.getSource<GeoJSONSource>(SOURCE);
    if (source !== undefined) source.setData(geojson);

    const positions: Array<{ lng: number; lat: number }> = [];
    for (const photo of photos) {
      const { lon, lat } = getEffectiveCoords(photo);
      positions.push({ lng: lon, lat });
    }
    this.bloom.updateData(positions);
  }
}

function buildGeoJSON(photos: Photo[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: photos.map((photo, index) => {
      const { lon, lat } = getEffectiveCoords(photo);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          index,
          uuid: photo.uuid,
          lat,
          gps: photo.gps ?? 'none'
        }
      };
    })
  };
}
