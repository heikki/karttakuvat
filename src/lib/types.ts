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

export interface MapStyle {
  version: number;
  sources: Record<string, unknown>;
  layers: unknown[];
}

export interface MapStyles {
  outdoors: MapStyle;
  satellite: MapStyle;
  mml_maastokartta: MapStyle;
  mml_ortokuva: MapStyle;
}
