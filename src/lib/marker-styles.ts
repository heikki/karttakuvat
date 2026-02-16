import type maplibregl from 'maplibre-gl';

type CirclePaint = maplibregl.CircleLayerSpecification['paint'];

export interface MarkerStyleConfig {
  label: string;
  /** Base circle layer — visible markers (classic) or invisible hit area (points) */
  hitArea: CirclePaint;
  shadow?: CirclePaint;
  /** Optional visible dot layer rendered on top of hit area */
  dot?: CirclePaint;
  selectedPaint?: CirclePaint;
  points?: boolean;
}

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

export const defaultMarkerStyle = 'points';

export const markerStyles: Record<string, MarkerStyleConfig> = {
  points: {
    label: 'Points',
    hitArea: {
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
    },
    points: true,
    dot: {
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
    },
  },

  classic: {
    label: 'Classic',
    hitArea: {
      'circle-color': gpsColor,
      'circle-radius': 8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
      'circle-pitch-alignment': 'map'
    },
  }
};
