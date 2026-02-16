const ALL_GPS = ['exif', 'inferred', 'user', 'none'];
const ALL_MEDIA = ['photo', 'video'];

interface SavedFilters {
  year: string;
  album: string;
  camera: string;
  gps: string[];
  media: string[];
}

function updateUrl(params: URLSearchParams): void {
  const qs = params.toString();
  history.replaceState(null, '', qs === '' ? location.pathname : `?${qs}`);
}

function currentParams(): URLSearchParams {
  return new URLSearchParams(location.search);
}

export function filtersToUrl(f: SavedFilters): void {
  const params = currentParams();
  // Clear filter params but preserve non-filter params (like photo)
  for (const key of ['year', 'album', 'camera', 'gps', 'media']) {
    params.delete(key);
  }
  if (f.year !== 'all') {
    params.set('year', f.year);
  }
  if (f.album !== 'all') {
    params.set('album', f.album);
  }
  if (f.camera !== 'all') {
    params.set('camera', f.camera);
  }
  if (
    f.gps.length !== ALL_GPS.length ||
    !ALL_GPS.every((v) => f.gps.includes(v))
  ) {
    params.set('gps', f.gps.join(','));
  }
  if (
    f.media.length !== ALL_MEDIA.length ||
    !ALL_MEDIA.every((v) => f.media.includes(v))
  ) {
    params.set('media', f.media.join(','));
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

export function mapViewToUrl(v: MapView): void {
  const params = currentParams();
  params.set('lat', v.lat.toFixed(5));
  params.set('lon', v.lon.toFixed(5));
  params.set('z', v.zoom.toFixed(2));
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

export function initStyleButtonGroup(
  id: string,
  onChange: (style: string) => void,
  fromUrl: () => string | null
): void {
  const container = document.getElementById(id);
  if (container === null) return;

  container.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.map-type-btn');
    if (btn === null) return;
    const style = btn.dataset.style;
    if (style === undefined) return;
    container.querySelector('.map-type-btn.active')?.classList.remove('active');
    btn.classList.add('active');
    onChange(style);
  });

  const saved = fromUrl();
  if (saved !== null) {
    const btn = container.querySelector(`.map-type-btn[data-style="${saved}"]`);
    if (btn !== null) {
      container
        .querySelector('.map-type-btn.active')
        ?.classList.remove('active');
      btn.classList.add('active');
      onChange(saved);
    }
  }
}

export function setSelectValue(id: string, value: string): void {
  const el = document.getElementById(id) as HTMLSelectElement | null;
  if (el === null) return;
  el.value = value;
  if (el.value !== value) el.value = 'all';
}

export function setButtonGroupActive(
  containerId: string,
  values: string[]
): void {
  const container = document.getElementById(containerId);
  if (container === null) return;
  for (const btn of Array.from(container.querySelectorAll('.filter-btn'))) {
    const val = (btn as HTMLElement).dataset.value;
    btn.classList.toggle('active', val !== undefined && values.includes(val));
  }
}
