export interface Photo {
  uuid: string;
  full: string;
  thumb: string;
  lat: number;
  lon: number;
  date: string;
  gps: string;
  albums: string[];
  photos_url?: string;
  // Internal use
  _index?: number;
  filename?: string;
}

export interface MapStyle {
  version: number;
  sources: Record<string, any>;
  layers: any[];
}

export interface MapStyles {
  opentopomap: MapStyle;
  satellite: MapStyle;
  osm: MapStyle;
  cyclosm: MapStyle;
}
