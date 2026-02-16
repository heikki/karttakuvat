import type maplibregl from 'maplibre-gl';

import type { GlowConfig } from './glow-layer';

type CirclePaint = maplibregl.CircleLayerSpecification['paint'];

export interface MarkerStyleConfig {
  label: string;
  markerPaint: CirclePaint;
  shadow?: CirclePaint;
  highlight?: CirclePaint;
  selectedPaint?: CirclePaint;
  glow?: GlowConfig;
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

export const defaultMarkerStyle = 'points';

export const markerStyles: Record<string, MarkerStyleConfig> = {
  points: {
    label: 'Points',
    markerPaint: {
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
    glow: {
      color: [1.0, 0.96, 0.88]
    },
    highlight: {
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
    })
  },

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
  }
};
