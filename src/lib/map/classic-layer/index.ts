import type { FeatureCollection, Point } from 'geojson';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapGL
} from 'maplibre-gl';

import { getEffectiveCoords } from '../../data';
import type { MarkerLayer, Photo } from '../../types';

const gpsColor = [
  'match',
  ['get', 'gps'],
  'exif',
  '#3b82f6',
  'user',
  '#22c55e',
  'inferred',
  '#f59e0b',
  '#9ca3af'
] as unknown as string;

const radius: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  3,
  8,
  6,
  14,
  10
];

// radius + stroke for the outline layer (pre-computed)
const outlineRadius: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  4,
  8,
  7.5,
  14,
  12
];

// radius + stroke*3 for the selection ring (pre-computed)
const selectedRadius: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  6,
  8,
  10.5,
  14,
  16
];

const selectedStroke: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  2,
  1,
  8,
  1.5,
  14,
  2
];

const sortKey = [
  '-',
  ['*', -1000000, ['get', 'lat']],
  ['get', 'index']
] as ExpressionSpecification;

const SOURCE = 'classic-source';
const LAYERS = [
  'classic-outlines',
  'classic-markers',
  'classic-selected-highlight',
  'classic-selected'
] as const;

export class ClassicLayer implements MarkerLayer {
  readonly id = 'classic-markers';
  private map: MapGL | null = null;

  install(map: MapGL) {
    this.map = map;

    map.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      maxzoom: 22
    });

    // Outline layer — white rings behind all fills
    map.addLayer({
      id: 'classic-outlines',
      type: 'circle',
      source: SOURCE,
      layout: { 'circle-sort-key': sortKey },
      paint: {
        'circle-color': '#fff',
        'circle-radius': outlineRadius,
        'circle-pitch-alignment': 'map'
      }
    });

    // Fill layer on top — colored dots, no stroke
    map.addLayer({
      id: 'classic-markers',
      type: 'circle',
      source: SOURCE,
      layout: { 'circle-sort-key': sortKey },
      paint: {
        'circle-color': gpsColor,
        'circle-radius': radius,
        'circle-pitch-alignment': 'map'
      }
    });

    // Selected marker — semi-transparent fill with white stroke
    map.addLayer({
      id: 'classic-selected-highlight',
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-color': 'rgba(0, 0, 0, 0.5)',
        'circle-radius': selectedRadius,
        'circle-stroke-width': selectedStroke,
        'circle-stroke-color': '#fff',
        'circle-pitch-alignment': 'map'
      },
      filter: ['==', ['get', 'uuid'], '']
    });

    // Selected marker — colored dot with white outline on top of highlight
    map.addLayer({
      id: 'classic-selected',
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-color': gpsColor,
        'circle-radius': radius,
        'circle-stroke-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          2,
          1,
          8,
          1.5,
          14,
          2
        ] as ExpressionSpecification,
        'circle-stroke-color': '#fff',
        'circle-pitch-alignment': 'map'
      },
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
  }

  highlight(photo: Photo | null) {
    if (this.map === null) return;
    const filter: FilterSpecification =
      photo === null
        ? ['==', ['get', 'uuid'], '']
        : ['==', ['get', 'uuid'], photo.uuid];
    for (const id of ['classic-selected-highlight', 'classic-selected']) {
      if (this.map.getLayer(id) !== undefined) {
        this.map.setFilter(id, filter);
      }
    }
  }

  setMarkers(photos: Photo[]) {
    if (this.map === null) return;
    const geojson = buildGeoJSON(photos);
    const source = this.map.getSource<GeoJSONSource>(SOURCE);
    if (source !== undefined) source.setData(geojson);
  }

  markerRadius = classicMarkerRadius;
}

function classicMarkerRadius(zoom: number): number {
  // Matches outlineRadius stops (visual edge of marker) + extra padding
  const stops = [2, 4, 8, 7.5, 14, 12];
  return lerpStops(zoom, stops);
}

function lerpStops(zoom: number, stops: number[]): number {
  if (zoom <= stops[0]!) return stops[1]!;
  for (let i = 0; i < stops.length - 2; i += 2) {
    const z0 = stops[i]!;
    const v0 = stops[i + 1]!;
    const z1 = stops[i + 2]!;
    const v1 = stops[i + 3]!;
    if (zoom <= z1) {
      const t = (zoom - z0) / (z1 - z0);
      return v0 + t * (v1 - v0);
    }
  }
  return stops[stops.length - 1]!;
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
