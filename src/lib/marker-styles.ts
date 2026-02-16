import { ClassicLayer } from './classic-layer';
import { PointsLayer } from './points-layer';
import type { MarkerLayer } from './types';

export interface MarkerStyleConfig {
  label: string;
  create: () => MarkerLayer;
}

export const defaultMarkerStyle = 'points';

export const markerStyles: Record<string, MarkerStyleConfig> = {
  points: {
    label: 'Points',
    create: () => new PointsLayer(),
  },
  classic: {
    label: 'Classic',
    create: () => new ClassicLayer(),
  }
};
