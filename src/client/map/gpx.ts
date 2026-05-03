import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { GeoJSONSource, Map as MapGL } from 'maplibre-gl';

import { state, subscribe } from '@common/data';

import mapUtils from './map-utils';
import zAnchors from './z-anchors';

// Sources and layers
const TRACK_SOURCE = 'gpx-tracks';
const WAYPOINT_SOURCE = 'gpx-waypoints';
const TRACK_OUTLINE_LAYER = 'gpx-track-outline';
const TRACK_LINE_LAYER = 'gpx-track-line';
const WAYPOINT_CIRCLE_LAYER = 'gpx-waypoint-circles';
const WAYPOINT_LABEL_LAYER = 'gpx-waypoint-labels';

// Module state
let map: MapGL | null = null;
let currentAlbum: string | null = null;
const hiddenFiles = new Set<string>();
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
let nextColorIndex = 0;

function init(m: MapGL): void {
  map = m;
  m.on('load', addGpxLayers);
  subscribe(() => {
    void loadGpxForAlbum(
      state.filters.album === 'all' ? null : state.filters.album
    );
  });
}

function addGpxLayers(): void {
  if (map === null) return;
  const before = zAnchors.id('gpx');

  map.addSource(TRACK_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: trackFeatures }
  });

  map.addSource(WAYPOINT_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: waypointFeatures }
  });

  map.addLayer(
    {
      id: TRACK_OUTLINE_LAYER,
      type: 'line',
      source: TRACK_SOURCE,
      paint: { 'line-color': 'rgba(0, 0, 0, 0.4)', 'line-width': 6 },
      layout: {
        'visibility': 'visible',
        'line-cap': 'round',
        'line-join': 'round'
      }
    },
    before
  );

  map.addLayer(
    {
      id: TRACK_LINE_LAYER,
      type: 'line',
      source: TRACK_SOURCE,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 3,
        'line-opacity': 0.85
      },
      layout: {
        'visibility': 'visible',
        'line-cap': 'round',
        'line-join': 'round'
      }
    },
    before
  );

  map.addLayer(
    {
      id: WAYPOINT_CIRCLE_LAYER,
      type: 'circle',
      source: WAYPOINT_SOURCE,
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-stroke-color': ['get', 'color']
      },
      layout: { visibility: 'visible' }
    },
    before
  );

  map.addLayer(
    {
      id: WAYPOINT_LABEL_LAYER,
      type: 'symbol',
      source: WAYPOINT_SOURCE,
      layout: {
        'visibility': 'visible',
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
    },
    before
  );
}

async function loadGpxForAlbum(album: string | null): Promise<void> {
  if (album === currentAlbum) return;
  currentAlbum = album;
  trackFeatures = [];
  waypointFeatures = [];

  if (album !== null && album !== 'all') {
    try {
      const res = await fetch(`/api/albums/${encodeURIComponent(album)}/files`);
      if (res.ok) {
        const files = (await res.json()) as Array<{
          name: string;
          visible: boolean;
        }>;
        hiddenFiles.clear();
        const gpxFiles: string[] = [];
        for (const f of files) {
          if (!f.name.toLowerCase().endsWith('.gpx')) continue;
          if (f.visible) {
            gpxFiles.push(f.name);
          } else {
            hiddenFiles.add(f.name);
          }
        }
        const color = TRACK_COLORS[nextColorIndex++ % TRACK_COLORS.length]!;
        await Promise.all(
          gpxFiles.map((name) => loadGpxFile(album, name, color))
        );
      }
    } catch {
      // No files for this album
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

    const distance = mapUtils.computePathDistance(coords);
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

function parseElevation(el: Element): number | null {
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
    const ele = parseElevation(wpt);
    const props: Record<string, unknown> = { name, color };
    if (ele !== null) props.ele = ele;
    waypointFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: props
    });
  }
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

  const trackSrc = map.getSource<GeoJSONSource>(TRACK_SOURCE);
  if (trackSrc !== undefined) {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: trackFeatures
    };
    trackSrc.setData(fc);
  }

  const wptSrc = map.getSource<GeoJSONSource>(WAYPOINT_SOURCE);
  if (wptSrc !== undefined) {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: waypointFeatures
    };
    wptSrc.setData(fc);
  }
}

/** Force-reload GPX tracks for the current album. */
function reloadTracks(): void {
  const album = currentAlbum;
  currentAlbum = null; // reset cache so loadGpxForAlbum re-fetches
  void loadGpxForAlbum(album);
}

/** Update the set of hidden filenames and reload tracks. */
function setHiddenFiles(hidden: Set<string>): void {
  hiddenFiles.clear();
  for (const f of hidden) hiddenFiles.add(f);
  reloadTracks();
}

export default { init, reloadTracks, setHiddenFiles };
