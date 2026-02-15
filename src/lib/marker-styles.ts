import type maplibregl from 'maplibre-gl';

type CirclePaint = maplibregl.CircleLayerSpecification['paint'];

export interface MarkerStyleConfig {
  label: string;
  markerPaint: CirclePaint;
  shadow?: CirclePaint;
  highlight?: CirclePaint;
  selectedPaint?: CirclePaint;
  ring: CirclePaint;
  pulseRadius: (zoom: number, t: number) => { radius: number; opacity: number };
  /** When true, night layer renders below all marker layers (markers glow on top of night) */
  nightBelow?: boolean;
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
      'circle-color': '#ffffff',
      'circle-radius': [
        'interpolate',
        ['exponential', 1.5],
        ['zoom'],
        4,
        4,
        8,
        7,
        12,
        12,
        16,
        18,
        20,
        24
      ],
      'circle-opacity': 0.6,
      'circle-blur': 0.5,
      'circle-stroke-width': 0,
      'circle-stroke-color': 'transparent',
      'circle-pitch-alignment': 'map'
    },
    highlight: {
      'circle-color': '#ffffff',
      'circle-radius': [
        'interpolate',
        ['exponential', 1.5],
        ['zoom'],
        4,
        1.5,
        8,
        3,
        12,
        5,
        16,
        8,
        20,
        11
      ],
      'circle-opacity': 1,
      'circle-blur': 0.4,
      'circle-pitch-alignment': 'map'
    },
    ring: {
      'circle-color': 'transparent',
      'circle-radius': 0,
      'circle-stroke-width': 0,
      'circle-stroke-color': 'transparent',
      'circle-pitch-alignment': 'map'
    },
    pulseRadius: () => ({
      radius: 0,
      opacity: 0
    }),
    nightBelow: true
  }
};
