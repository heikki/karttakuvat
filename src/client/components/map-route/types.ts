export interface RoutePoint {
  type: 'photo' | 'waypoint';
  uuid?: string;
  lon: number;
  lat: number;
}

export interface RouteSegment {
  method: 'straight' | 'driving' | 'walking' | 'hiking' | 'cycling' | 'none';
  geometry: Array<[number, number]>;
}

export interface RouteData {
  points: RoutePoint[];
  segments: RouteSegment[];
}
