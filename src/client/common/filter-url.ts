// Restore saved view state into URL before any component reads it
if (location.search === '') {
  const saved = localStorage.getItem('viewState');
  if (saved !== null && saved !== '') {
    history.replaceState(null, '', `?${saved}`);
  }
}

const ALL_GPS = ['exif', 'inferred', 'user', 'none'];
const ALL_MEDIA = ['photo', 'video'];

interface SavedFilters {
  year: string;
  album: string;
  camera: string;
  gps: string[];
  media: string[];
}

let viewSaveTimer: ReturnType<typeof setTimeout> | null = null;

function saveViewState(params: URLSearchParams, immediate = false): void {
  if (viewSaveTimer !== null) clearTimeout(viewSaveTimer);
  const doSave = () => {
    viewSaveTimer = null;
    const obj = Object.fromEntries(params);
    delete obj.id;
    const qs = new URLSearchParams(obj).toString();
    localStorage.setItem('viewState', qs);
    void fetch('/api/view-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    });
  };
  if (immediate) {
    doSave();
  } else {
    viewSaveTimer = setTimeout(doSave, 1000);
  }
}

let pendingUrlParams: URLSearchParams | null = null;
let urlUpdateTimer: ReturnType<typeof setTimeout> | null = null;

function flushUrl(immediate = false) {
  if (pendingUrlParams === null) return;
  const qs = pendingUrlParams.toString();
  try {
    history.replaceState(null, '', qs === '' ? location.pathname : `?${qs}`);
  } catch {
    // SecurityError: browser rate-limits replaceState (100/10s)
  }
  saveViewState(pendingUrlParams, immediate);
  pendingUrlParams = null;
  urlUpdateTimer = null;
}

export function flushViewState(): void {
  if (urlUpdateTimer !== null) {
    clearTimeout(urlUpdateTimer);
    urlUpdateTimer = null;
  }
  flushUrl(true);
}

export function resetAllViewParams(): void {
  updateUrl(new URLSearchParams());
}

function updateUrl(params: URLSearchParams): void {
  pendingUrlParams = params;
  urlUpdateTimer ??= setTimeout(flushUrl, 100);
}

function currentParams(): URLSearchParams {
  return new URLSearchParams(location.search);
}

export function filtersToUrl(filters: SavedFilters): void {
  const params = currentParams();
  // Clear filter params but preserve non-filter params (like photo)
  for (const key of ['year', 'album', 'camera', 'gps', 'media']) {
    params.delete(key);
  }
  if (filters.year !== 'all') {
    params.set('year', filters.year);
  }
  if (filters.album !== 'all') {
    params.set('album', filters.album);
  }
  if (filters.camera !== 'all') {
    params.set('camera', filters.camera);
  }
  if (
    filters.gps.length !== ALL_GPS.length ||
    !ALL_GPS.every((v) => filters.gps.includes(v))
  ) {
    params.set('gps', filters.gps.join(','));
  }
  if (
    filters.media.length !== ALL_MEDIA.length ||
    !ALL_MEDIA.every((v) => filters.media.includes(v))
  ) {
    params.set('media', filters.media.join(','));
  }
  updateUrl(params);
}

export function photoToUrl(uuid: string | null): void {
  const params = currentParams();
  if (uuid === null) {
    params.delete('id');
  } else {
    params.set('id', uuid);
  }
  updateUrl(params);
}

export function photoFromUrl(): string | null {
  return new URLSearchParams(location.search).get('id');
}

export function filtersFromUrl(): Partial<SavedFilters> | null {
  const params = new URLSearchParams(location.search);
  const hasFilters = ['year', 'album', 'camera', 'gps', 'media'].some((k) =>
    params.has(k)
  );
  if (!hasFilters) return null;
  const result: Partial<SavedFilters> = {};
  const year = params.get('year');
  if (year !== null) result.year = year;
  const album = params.get('album');
  if (album !== null) result.album = album;
  const camera = params.get('camera');
  if (camera !== null) result.camera = camera;
  const gps = params.get('gps');
  if (gps !== null) {
    result.gps = gps.split(',').filter((v) => ALL_GPS.includes(v));
  }
  const media = params.get('media');
  if (media !== null) {
    result.media = media.split(',').filter((v) => ALL_MEDIA.includes(v));
  }
  return result;
}

interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

export function mapViewToUrl(view: MapView): void {
  const params = currentParams();
  params.set('lat', view.lat.toFixed(5));
  params.set('lon', view.lon.toFixed(5));
  params.set('z', view.zoom.toFixed(2));
  updateUrl(params);
}

export function mapViewFromUrl(): MapView | null {
  const params = new URLSearchParams(location.search);
  const lat = params.get('lat');
  const lon = params.get('lon');
  const z = params.get('z');
  if (lat === null || lon === null || z === null) return null;
  const parsed = {
    lat: parseFloat(lat),
    lon: parseFloat(lon),
    zoom: parseFloat(z)
  };
  if (isNaN(parsed.lat) || isNaN(parsed.lon) || isNaN(parsed.zoom)) {
    return null;
  }
  return parsed;
}

export function mapStyleToUrl(style: string): void {
  const params = currentParams();
  if (style === 'satellite') {
    params.delete('style');
  } else {
    params.set('style', style);
  }
  updateUrl(params);
}

export function mapStyleFromUrl(): string | null {
  return new URLSearchParams(location.search).get('style');
}

export function markerStyleToUrl(style: string): void {
  const params = currentParams();
  if (style === 'points') {
    params.delete('markers');
  } else {
    params.set('markers', style);
  }
  updateUrl(params);
}

export function markerStyleFromUrl(): string | null {
  return new URLSearchParams(location.search).get('markers');
}

export function routeToUrl(visible: boolean): void {
  const params = currentParams();
  if (visible) {
    params.set('route', '1');
  } else {
    params.delete('route');
  }
  updateUrl(params);
}

export function routeFromUrl(): boolean {
  return new URLSearchParams(location.search).get('route') === '1';
}
