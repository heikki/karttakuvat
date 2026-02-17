import type { Map as MapGL } from 'maplibre-gl';

export interface Photo {
  uuid: string;
  type: 'photo' | 'video';
  full: string;
  thumb: string;
  lat: number | null;
  lon: number | null;
  date: string;
  tz: string | null;
  camera: string | null;
  gps: string | null;
  albums: string[];
  photos_url?: string;
  duration?: string | null;
  // Internal use
  _index?: number;
  filename?: string;
}

interface MapStyle {
  version: number;
  sources: Record<string, unknown>;
  layers: unknown[];
}

export interface MapStyles {
  satellite: MapStyle;
  topo: MapStyle;
  mml_maastokartta: MapStyle;
  mml_ortokuva: MapStyle;
}

export interface MarkerLayer {
  readonly id: string;
  install: (map: MapGL) => void;
  uninstall: () => void;
  toggle: (visible: boolean) => void;
  highlight: (photo: Photo | null) => void;
  setMarkers: (photos: Photo[]) => void;
  markerRadius: (zoom: number) => number;
}
