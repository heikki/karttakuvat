import { state, subscribe } from '@common/data';
import { GpxDataChangedEvent, SetGpxVisibleEvent } from '@common/events';
import turfDistance from '@turf/distance';
import { point } from '@turf/helpers';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { GeoJSONSource, Map as MapGL } from 'maplibre-gl';

// Sources and layers
const TRACK_SOURCE = 'gpx-tracks';
const WAYPOINT_SOURCE = 'gpx-waypoints';
const TRACK_OUTLINE_LAYER = 'gpx-track-outline';
const TRACK_LINE_LAYER = 'gpx-track-line';
const WAYPOINT_CIRCLE_LAYER = 'gpx-waypoint-circles';
const WAYPOINT_LABEL_LAYER = 'gpx-waypoint-labels';

const ALL_LAYERS = [
  TRACK_OUTLINE_LAYER,
  TRACK_LINE_LAYER,
  WAYPOINT_CIRCLE_LAYER,
  WAYPOINT_LABEL_LAYER
];
const ALL_SOURCES = [TRACK_SOURCE, WAYPOINT_SOURCE];

// Module state
let map: MapGL | null = null;
let visible = true;
let currentAlbum: string | null = null;
let trackFeatures: Array<Feature<LineString>> = [];
let waypointFeatures: Array<Feature<Point>> = [];

// Album color palette
const TRACK_COLORS = [
  '#ff6b6b',
  '#4ecdc4',
  '#ffe66d',
  '#a29bfe',
  '#fd79a8',
  '#00cec9',
  '#fab1a0',
  '#81ecec'
];
let colorIndex = 0;

export function initGpx(m: MapGL): void {
  map = m;
  subscribe(() => {
    void loadGpxForAlbum(
      state.filters.album === 'all' ? null : state.filters.album
    );
  });
  document.addEventListener(SetGpxVisibleEvent.type, (e) => {
    setGpxVisible(e.visible);
  });
}

export function addGpxLayers(): void {
  if (map === null) return;

  for (const id of ALL_LAYERS) {
    if (map.getLayer(id) !== undefined) map.removeLayer(id);
  }
  for (const id of ALL_SOURCES) {
    if (map.getSource(id) !== undefined) map.removeSource(id);
  }

  const vis = visible ? 'visible' : 'none';

  map.addSource(TRACK_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: trackFeatures }
  });

  map.addSource(WAYPOINT_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: waypointFeatures }
  });

  map.addLayer({
    id: TRACK_OUTLINE_LAYER,
    type: 'line',
    source: TRACK_SOURCE,
    paint: { 'line-color': 'rgba(0, 0, 0, 0.4)', 'line-width': 6 },
    layout: { 'visibility': vis, 'line-cap': 'round', 'line-join': 'round' }
  });

  map.addLayer({
    id: TRACK_LINE_LAYER,
    type: 'line',
    source: TRACK_SOURCE,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 3,
      'line-opacity': 0.85
    },
    layout: { 'visibility': vis, 'line-cap': 'round', 'line-join': 'round' }
  });

  map.addLayer({
    id: WAYPOINT_CIRCLE_LAYER,
    type: 'circle',
    source: WAYPOINT_SOURCE,
    paint: {
      'circle-radius': 5,
      'circle-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-stroke-color': ['get', 'color']
    },
    layout: { visibility: vis }
  });

  map.addLayer({
    id: WAYPOINT_LABEL_LAYER,
    type: 'symbol',
    source: WAYPOINT_SOURCE,
    layout: {
      'visibility': vis,
      'text-field': ['get', 'name'],
      'text-size': 11,
      'text-offset': [0, 1.4],
      'text-anchor': 'top',
      'text-optional': true
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0, 0, 0, 0.7)',
      'text-halo-width': 1.5
    }
  });
}

export async function loadGpxForAlbum(album: string | null): Promise<void> {
  if (album === currentAlbum) return;
  currentAlbum = album;
  trackFeatures = [];
  waypointFeatures = [];

  if (album !== null && album !== 'all') {
    try {
      const res = await fetch(`/api/gpx/${encodeURIComponent(album)}`);
      if (res.ok) {
        const files = (await res.json()) as string[];
        const color = TRACK_COLORS[colorIndex++ % TRACK_COLORS.length]!;
        await Promise.all(files.map((f) => loadGpxFile(album, f, color)));
      }
    } catch {
      // No GPX files for this album
    }
  }

  updateSources();
}

async function loadGpxFile(
  album: string,
  filename: string,
  color: string
): Promise<void> {
  try {
    const url = `/albums/${encodeURIComponent(album)}/${encodeURIComponent(filename)}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    parseTracks(doc, filename, color);
    parseWaypoints(doc, color);
  } catch {
    // skip unparseable files
  }
}

function parseTracks(doc: Document, filename: string, color: string): void {
  const tracks = Array.from(doc.querySelectorAll('trk'));
  for (const trk of tracks) {
    const name =
      trk.querySelector('name')?.textContent ?? filename.replace(/\.gpx$/i, '');
    const { coords, elevations } = extractTrackPoints(trk);
    if (coords.length < 2) continue;

    const distance = computeTrackDistance(coords);
    const { gain, loss } = computeElevation(elevations);

    trackFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { name, color, distance, elevGain: gain, elevLoss: loss }
    });
  }
}

function extractTrackPoints(trk: Element): {
  coords: Array<[number, number]>;
  elevations: number[];
} {
  const coords: Array<[number, number]> = [];
  const elevations: number[] = [];
  const points = Array.from(trk.querySelectorAll('trkpt'));

  for (const pt of points) {
    const lat = parseFloat(pt.getAttribute('lat') ?? '');
    const lon = parseFloat(pt.getAttribute('lon') ?? '');
    if (isNaN(lat) || isNaN(lon)) continue;
    coords.push([lon, lat]);
    const eleText = pt.querySelector('ele')?.textContent ?? null;
    if (eleText !== null) {
      const v = parseFloat(eleText);
      if (!isNaN(v)) elevations.push(v);
    }
  }
  return { coords, elevations };
}

function parseEle(el: Element): number | null {
  const text = el.querySelector('ele')?.textContent ?? null;
  if (text === null) return null;
  const v = parseFloat(text);
  return isNaN(v) ? null : v;
}

function parseWaypoints(doc: Document, color: string): void {
  const wpts = Array.from(doc.querySelectorAll('wpt'));
  for (const wpt of wpts) {
    const lat = parseFloat(wpt.getAttribute('lat') ?? '');
    const lon = parseFloat(wpt.getAttribute('lon') ?? '');
    if (isNaN(lat) || isNaN(lon)) continue;
    const name = wpt.querySelector('name')?.textContent ?? '';
    const ele = parseEle(wpt);
    const props: Record<string, unknown> = { name, color };
    if (ele !== null) props.ele = ele;
    waypointFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: props
    });
  }
}

function computeTrackDistance(coords: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += turfDistance(point(coords[i - 1]!), point(coords[i]!), {
      units: 'kilometers'
    });
  }
  return total;
}

function computeElevation(elevations: number[]): {
  gain: number;
  loss: number;
} {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i]! - elevations[i - 1]!;
    if (diff > 0) gain += diff;
    else loss -= diff;
  }
  return { gain, loss };
}

function updateSources(): void {
  if (map === null) return;

  const trackSrc = map.getSource(TRACK_SOURCE);
  if (trackSrc !== undefined) {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: trackFeatures
    };
    (trackSrc as GeoJSONSource).setData(fc);
  }

  const wptSrc = map.getSource(WAYPOINT_SOURCE);
  if (wptSrc !== undefined) {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: waypointFeatures
    };
    (wptSrc as GeoJSONSource).setData(fc);
  }

  const hasData = trackFeatures.length > 0 || waypointFeatures.length > 0;
  document.dispatchEvent(new GpxDataChangedEvent(hasData));
}

export function setGpxVisible(v: boolean): void {
  visible = v;
  setLayerVisibility(visible);
}

function setLayerVisibility(show: boolean): void {
  if (map === null) return;
  const v = show ? 'visible' : 'none';
  for (const id of ALL_LAYERS) {
    if (map.getLayer(id) !== undefined) {
      map.setLayoutProperty(id, 'visibility', v);
    }
  }
}
