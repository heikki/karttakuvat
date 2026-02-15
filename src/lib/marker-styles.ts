import type maplibregl from 'maplibre-gl';

type CirclePaint = maplibregl.CircleLayerSpecification['paint'];

export interface MarkerStyleConfig {
  label: string;
  markerPaint: CirclePaint;
  shadow?: CirclePaint;
  highlight?: CirclePaint;
  ring: CirclePaint;
  pulseRadius: (zoom: number, t: number) => { radius: number; opacity: number };
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

export const defaultMarkerStyle = 'classic';

export const markerStyles: Record<string, MarkerStyleConfig> = {
  classic: {
    label: 'Classic',
    markerPaint: {
      'circle-color': gpsColor,
      'circle-radius': 8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
      'circle-pitch-alignment': 'map'
    },
    ring: {
      'circle-color': 'transparent',
      'circle-radius': 18,
      'circle-stroke-width': 3,
      'circle-stroke-color': '#007AFF',
      'circle-stroke-opacity': 0.6,
      'circle-pitch-alignment': 'map'
    },
    pulseRadius: (_zoom, t) => ({
      radius: 12 + 8 * t,
      opacity: 0.8 - 0.8 * t
    })
  },

  glass: {
    label: 'Glass',
    markerPaint: {
      'circle-color': gpsColor,
      'circle-radius': [
        'interpolate',
        ['exponential', 1.5],
        ['zoom'],
        4,
        5,
        8,
        8,
        12,
        12,
        16,
        18,
        20,
        24
      ],
      'circle-stroke-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        1,
        8,
        2,
        14,
        3,
        20,
        4
      ],
      'circle-stroke-color': '#fff',
      'circle-pitch-alignment': 'map'
    },
    shadow: {
      'circle-color': '#000000',
      'circle-radius': [
        'interpolate',
        ['exponential', 1.5],
        ['zoom'],
        4,
        7,
        8,
        11,
        12,
        16,
        16,
        24,
        20,
        32
      ],
      'circle-opacity': 0.35,
      'circle-blur': 1,
      'circle-pitch-alignment': 'map'
    },
    highlight: {
      'circle-color': '#ffffff',
      'circle-radius': [
        'interpolate',
        ['exponential', 1.5],
        ['zoom'],
        4,
        2.5,
        8,
        4,
        12,
        6,
        16,
        9,
        20,
        12
      ],
      'circle-opacity': 0.3,
      'circle-blur': 0.6,
      'circle-translate': [0, -1.5],
      'circle-pitch-alignment': 'map'
    },
    ring: {
      'circle-color': 'transparent',
      'circle-radius': 18,
      'circle-stroke-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        4,
        2,
        8,
        3,
        14,
        4,
        20,
        5
      ],
      'circle-stroke-color': '#007AFF',
      'circle-stroke-opacity': 0.6,
      'circle-pitch-alignment': 'map'
    },
    pulseRadius: (zoom, t) => {
      // Match the zoom interpolation curve for base marker radius
      const base = zoom <= 4 ? 5 : zoom >= 20 ? 24 : 5 + (zoom - 4) * 1.2;
      return {
        radius: base * 1.5 + base * 0.5 * t,
        opacity: 0.8 - 0.8 * t
      };
    }
  }
};
