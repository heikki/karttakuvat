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

const markerPaint: CircleLayerSpecification['paint'] = {
  'circle-color': gpsColor,
  'circle-radius': 8,
  'circle-stroke-width': 2,
  'circle-stroke-color': '#fff',
  'circle-pitch-alignment': 'map'
};

const sortKey = [
  '-',
  ['*', -1000000, ['get', 'lat']],
  ['get', 'index']
] as ExpressionSpecification;

const SOURCE = 'classic-source';
const LAYERS = ['classic-markers', 'classic-selected'] as const;

export class ClassicLayer implements MarkerLayer {
  readonly id = 'classic-markers';
  private map: MapGL | null = null;

  install(map: MapGL) {
    this.map = map;

    map.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer({
      id: 'classic-markers',
      type: 'circle',
      source: SOURCE,
      layout: { 'circle-sort-key': sortKey },
      paint: markerPaint
    });

    map.addLayer({
      id: 'classic-selected',
      type: 'circle',
      source: SOURCE,
      paint: markerPaint,
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
    if (this.map.getLayer('classic-selected') !== undefined) {
      this.map.setFilter('classic-selected', filter);
    }
  }

  setMarkers(photos: Photo[]) {
    if (this.map === null) return;
    const geojson = buildGeoJSON(photos);
    const source = this.map.getSource<GeoJSONSource>(SOURCE);
    if (source !== undefined) source.setData(geojson);
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
