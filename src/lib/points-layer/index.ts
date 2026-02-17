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
      data: { type: 'FeatureCollection', features: [] },
      maxzoom: 22
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

    const features: FeatureCollection<Point>['features'] = [];
    const positions: Array<{ lng: number; lat: number; uuid: string }> = [];
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]!;
      const { lon, lat } = getEffectiveCoords(photo);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { index: i, uuid: photo.uuid, lat, gps: photo.gps ?? 'none' }
      });
      positions.push({ lng: lon, lat, uuid: photo.uuid });
    }

    const source = this.map.getSource<GeoJSONSource>(SOURCE);
    if (source !== undefined) {
      source.setData({ type: 'FeatureCollection', features });
    }
    this.bloom.updateData(positions);
  }

  markerRadius = pointsMarkerRadius;
}

function pointsMarkerRadius(zoom: number): number {
  // Matches dotPaint circle-radius: exponential 1.5 interpolation
  const base = 1.5;
  const stops = [4, 1, 8, 2, 12, 3, 16, 5, 20, 7];
  if (zoom <= stops[0]!) return stops[1]!;
  for (let i = 0; i < stops.length - 2; i += 2) {
    const z0 = stops[i]!;
    const v0 = stops[i + 1]!;
    const z1 = stops[i + 2]!;
    const v1 = stops[i + 3]!;
    if (zoom <= z1) {
      const t = (zoom - z0) / (z1 - z0);
      const factor = (base ** t - 1) / (base - 1);
      return v0 + (v1 - v0) * factor;
    }
  }
  return stops[stops.length - 1]!;
}

