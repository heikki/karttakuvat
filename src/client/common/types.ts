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
  filename?: string;
}

export interface MarkerLayer {
  readonly id: string;
  install: (map: MapGL, photos: Photo[]) => void;
  uninstall: () => void;
  toggle: (visible: boolean) => void;
  highlight: (photo: Photo | null) => void;
  setMarkers: (photos: Photo[]) => void;
  markerRadius: (zoom: number) => number;
}
