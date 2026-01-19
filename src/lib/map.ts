import type { FeatureCollection, Point } from 'geojson';
import maplibregl from 'maplibre-gl';
import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';

import { mapStyles } from './config';
import { state, subscribe } from './data';
import type { MapStyles, Photo } from './types';
import { updateLightboxGroup } from './ui';
import { compareDates, formatDate, getThumbUrl } from './utils';

// Declare window augmentation for map
declare global {
  interface Window {
    map?: maplibregl.Map;
  }
}

// Global map variable (local to module)
// eslint-disable-next-line @typescript-eslint/init-declarations -- map is initialized in initMap() which is called before any other usage
let map: maplibregl.Map;
let currentPopup: maplibregl.Popup | null = null;
let clusterPhotos: Photo[] = [];
let currentSinglePhotoIndex: number | null = null;
let currentGroupIndex = 0;

// Selection state
let isSelecting = false;
let selectionStart: { x: number; y: number } | null = null;

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: mapStyles.opentopomap as StyleSpecification,
    center: [29.52, 64.13],
    zoom: 10,
    boxZoom: false,
    keyboard: false
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

  // Expose map to window
  window.map = map;

  map.on('load', () => {
    addPhotoLayers();
    addSelectionLayer();
    setupMarkerInteractions();
    setupRectangularSelection();

    updateMapData();
    if (state.filteredPhotos.length > 0) fitToPhotos();
  });

  subscribe(() => {
    if (map?.isStyleLoaded() === true) {
      updateMapData();
    }
  });
}

function updateMapData() {
  const source = map.getSource('photos');
  if (source === undefined) return;
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- cast to specific source type is required
  const geoSource = source as maplibregl.GeoJSONSource;
  geoSource.setData(createGeoJSON());

  const mapBounds = map.getBounds();
  const allVisible =
    state.filteredPhotos.length === 0 ||
    state.filteredPhotos.every((p) => mapBounds.contains([p.lon, p.lat]));
  if (!allVisible) {
    fitToPhotos();
  }
}

export function changeMapStyle(styleKey: string) {
  const style = mapStyles[styleKey as keyof MapStyles] as
    | StyleSpecification
    | undefined;
  if (style === undefined) return;

  map.setStyle(style);
  void map.once('idle', () => {
    addPhotoLayers();
    addSelectionLayer();
    setupMarkerInteractions();
    updateMapData();
  });
}

function createGeoJSON(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: state.filteredPhotos.map((photo, index) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [photo.lon, photo.lat]
      },
      properties: {
        index,
        lat: photo.lat
      }
    }))
  };
}

function addPhotoLayers() {
  if (map.getLayer('photo-markers-highlight-ring')) {
    map.removeLayer('photo-markers-highlight-ring');
  }
  if (map.getLayer('photo-markers-highlight')) {
    map.removeLayer('photo-markers-highlight');
  }
  if (map.getLayer('photo-markers')) map.removeLayer('photo-markers');
  if (map.getSource('photos')) map.removeSource('photos');

  map.addSource('photos', {
    type: 'geojson',
    data: createGeoJSON()
  });

  map.addLayer({
    id: 'photo-markers-highlight-ring',
    type: 'circle',
    source: 'photos',
    paint: {
      'circle-color': 'transparent',
      'circle-radius': 18,
      'circle-stroke-width': 3,
      'circle-stroke-color': '#007AFF',
      'circle-stroke-opacity': 0.6
    },
    filter: ['==', ['get', 'index'], -1]
  });

  map.addLayer({
    id: 'photo-markers',
    type: 'circle',
    source: 'photos',
    layout: {
      'circle-sort-key': ['*', -1, ['get', 'lat']]
    },
    paint: {
      'circle-color': '#3b82f6',
      'circle-radius': 8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff'
    }
  });

  map.addLayer({
    id: 'photo-markers-highlight',
    type: 'circle',
    source: 'photos',
    paint: {
      'circle-color': '#f59e0b',
      'circle-radius': 10,
      'circle-stroke-width': 3,
      'circle-stroke-color': '#fff'
    },
    filter: ['==', ['get', 'index'], -1]
  });
}

function highlightMarker(index: number | null) {
  const filter: FilterSpecification =
    index === null
      ? ['==', ['get', 'index'], -1]
      : ['==', ['get', 'index'], index];

  if (map.getLayer('photo-markers-highlight')) {
    map.setFilter('photo-markers-highlight', filter);
  }
  if (map.getLayer('photo-markers-highlight-ring')) {
    map.setFilter('photo-markers-highlight-ring', filter);
  }
}

function setupMarkerInteractions() {
  map.on('click', 'photo-markers', (e) => {
    e.preventDefault();
    e.originalEvent.stopPropagation();

    if (
      e.features === undefined ||
      e.features === null ||
      e.features.length === 0
    )
      return;
    const feature = e.features[0]!;
    const clickedIndex = feature.properties?.index as number | undefined;

    // Check if part of cluster
    if (currentPopup !== null && clusterPhotos.length > 1) {
      const groupIndex = clusterPhotos.findIndex(
        (p) => p._index === clickedIndex
      );
      if (groupIndex !== -1) {
        selectGroupPhoto(groupIndex);
        scrollToActiveThumbnail();
        return;
      }
    }

    const geom = feature.geometry as Point;
    const coords: [number, number] = [
      geom.coordinates[0]!,
      geom.coordinates[1]!
    ];
    if (clickedIndex === undefined) return;
    showPopup({ index: clickedIndex }, coords);
  });

  map.on('mouseenter', 'photo-markers', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'photo-markers', () => {
    map.getCanvas().style.cursor = '';
  });

  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['photo-markers']
    });
    if (features.length > 0) return;
    const selectionFeatures = map.queryRenderedFeatures(e.point, {
      layers: ['selection-fill']
    });
    if (selectionFeatures.length > 0) return;
    if (currentPopup !== null) currentPopup.remove();
  });
}

interface FeatureProps {
  index: number;
}
function showPopup(props: FeatureProps, coords: [number, number]) {
  if (currentPopup !== null) currentPopup.remove();

  const index = props.index;
  const photo = state.filteredPhotos[index];
  if (photo === undefined) return;

  currentSinglePhotoIndex = index;
  clusterPhotos = [];
  highlightMarker(index);

  const photosLink =
    photo.photos_url !== undefined && photo.photos_url !== ''
      ? `<a class="photos-link" href="${photo.photos_url}">Open in Photos</a>`
      : '';

  const popupContent = `
        <div class="photo-popup">
            <img src="${getThumbUrl(photo)}" alt="Photo" onclick="window.showLightbox(${index})"
                    onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22150%22/><text x=%22100%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%23999%22>Preview unavailable</text></svg>'" />
            <div class="info">${formatDate(photo.date)}<br>${photo.lat.toFixed(4)}°N, ${photo.lon.toFixed(4)}°E</div>
            ${photosLink}
        </div>`;

  currentPopup = new maplibregl.Popup({
    closeButton: false,
    maxWidth: '320px',
    anchor: 'bottom',
    offset: [0, -12]
  })
    .setLngLat(coords)
    .setHTML(popupContent)
    .addTo(map);

  currentPopup.on('close', () => {
    highlightMarker(null);
    currentSinglePhotoIndex = null;
  });

  panToFitPopup(coords);
}

interface MapFeature {
  properties: Record<string, unknown>;
}
function showMultiPhotoPopup(
  features: MapFeature[],
  coords: [number, number],
  keepSelection = false
) {
  if (currentPopup !== null) currentPopup.remove();
  currentSinglePhotoIndex = null;

  if (!keepSelection) clearSelection();

  clusterPhotos = features
    .map((f) => {
      const idx = f.properties.index as number;
      const photo = state.filteredPhotos[idx];
      if (photo === undefined) return undefined;
      const p: Photo = { ...photo, _index: idx };
      return p;
    })
    .filter((p): p is Photo => p !== undefined);

  if (clusterPhotos.length === 0) return;

  // Sync with UI
  updateLightboxGroup(clusterPhotos);

  clusterPhotos.sort(compareDates);
  currentGroupIndex = 0;
  highlightMarker(clusterPhotos[0]!._index ?? 0);

  const firstPhoto = clusterPhotos[0]!;
  const lastPhoto = clusterPhotos[clusterPhotos.length - 1];

  let dateRangeStr = '';
  if (
    lastPhoto !== undefined &&
    firstPhoto.date !== '' &&
    lastPhoto.date !== ''
  ) {
    const firstDate = formatDate(firstPhoto.date);
    const lastDate = formatDate(lastPhoto.date);
    dateRangeStr =
      firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`;
  } else if (firstPhoto.date !== undefined && firstPhoto.date !== '') {
    dateRangeStr = formatDate(firstPhoto.date);
  }

  const thumbsHtml = clusterPhotos
    .map(
      (photo, i) => `
        <img class="thumb ${i === 0 ? 'active' : ''}"
                src="${getThumbUrl(photo)}"
                onclick="window.selectGroupPhoto(${i})"
                onerror="this.style.display='none'" />
    `
    )
    .join('');

  const firstPhotosLink =
    firstPhoto.photos_url !== undefined && firstPhoto.photos_url !== ''
      ? `<a class="photos-link" id="group-photos-link" href="${firstPhoto.photos_url}">Open in Photos</a>`
      : '';

  const popupContent = `
        <div class="photo-popup">
            <div class="photo-count">${clusterPhotos.length} photos${dateRangeStr !== '' ? ` • ${dateRangeStr}` : ''}</div>
            <img class="main-image" id="group-main-img" src="${getThumbUrl(firstPhoto)}"
                    onclick="window.showGroupLightbox(0)" 
                    onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22150%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22150%22/><text x=%22100%22 y=%2275%22 text-anchor=%22middle%22 fill=%22%23999%22>Preview unavailable</text></svg>'" />
            <div class="info" id="group-info">${formatDate(firstPhoto.date)}<br>${firstPhoto.lat.toFixed(4)}°N, ${firstPhoto.lon.toFixed(4)}°E</div>
            ${firstPhotosLink}
            <div class="thumb-strip">${thumbsHtml}</div>
        </div>`;

  currentPopup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    maxWidth: '400px',
    anchor: 'bottom',
    offset: [0, -12]
  })
    .setLngLat(coords)
    .setHTML(popupContent)
    .addTo(map);

  currentPopup.on('close', () => {
    clearSelection();
    highlightMarker(null);
    clusterPhotos = [];
  });

  if (!keepSelection) panToFitPopup(coords);
}

export function selectGroupPhoto(index: number) {
  const photo = clusterPhotos[index];
  if (photo === undefined) return;

  const mainImg = document.getElementById(
    'group-main-img'
  ) as HTMLImageElement | null;
  const info = document.getElementById('group-info');
  const photosLink = document.getElementById(
    'group-photos-link'
  ) as HTMLAnchorElement | null;

  if (mainImg !== null) {
    mainImg.src = getThumbUrl(photo);
    mainImg.onclick = () => {
      window.showGroupLightbox(index);
    };
  }
  if (info !== null) {
    info.innerHTML = `${formatDate(photo.date)}<br>${photo.lat.toFixed(4)}°N, ${photo.lon.toFixed(4)}°E`;
  }
  if (photosLink !== null) {
    if (photo.photos_url !== undefined && photo.photos_url !== '') {
      photosLink.href = photo.photos_url;
      photosLink.style.display = 'inline-block';
    } else {
      photosLink.style.display = 'none';
    }
  }

  document.querySelectorAll('.photo-popup .thumb').forEach((thumb, i) => {
    thumb.classList.toggle('active', i === index);
  });

  highlightMarker(photo._index ?? null);
  currentGroupIndex = index;
}

function scrollToActiveThumbnail() {
  const activeThumb = document.querySelector('.photo-popup .thumb.active');
  if (activeThumb !== null) {
    activeThumb.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center'
    });
  }
}

function panToFitPopup(coords: [number, number]) {
  setTimeout(() => {
    if (currentPopup === null) return;
    const popupEl = currentPopup.getElement();
    if (popupEl === null) return;
    const mapContainer = map.getContainer();
    const mapRect = mapContainer.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();
    const padding = { top: 10, right: 260, bottom: 120, left: 10 };

    let panX = 0;
    let panY = 0;

    if (popupRect.top < mapRect.top + padding.top) {
      panY = popupRect.top - mapRect.top - padding.top;
    }
    if (popupRect.bottom > mapRect.bottom - padding.bottom) {
      panY = popupRect.bottom - mapRect.bottom + padding.bottom;
    }
    if (popupRect.left < mapRect.left + padding.left) {
      panX = popupRect.left - mapRect.left - padding.left;
    }
    if (popupRect.right > mapRect.right - padding.right) {
      panX = popupRect.right - mapRect.right + padding.right;
    }

    if (panX !== 0 || panY !== 0) map.panBy([panX, panY], { duration: 300 });
  }, 50);
}

export function fitToPhotos() {
  if (state.filteredPhotos.length === 0) return;
  const bounds = new maplibregl.LngLatBounds();
  state.filteredPhotos.forEach((p) => bounds.extend([p.lon, p.lat]));
  map.fitBounds(bounds, {
    padding: { top: 20, bottom: 150, left: 20, right: 270 }
  });
}

function addSelectionLayer() {
  map.addSource('selection', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'selection-fill',
    type: 'fill',
    source: 'selection',
    paint: { 'fill-color': '#007AFF', 'fill-opacity': 0.1 }
  });
  map.addLayer({
    id: 'selection-outline',
    type: 'line',
    source: 'selection',
    paint: {
      'line-color': '#007AFF',
      'line-width': 2,
      'line-dasharray': [4, 2]
    }
  });
}

function updateSelectionLayer(
  sw: { lng: number; lat: number } | null,
  ne: { lng: number; lat: number } | null
) {
  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- cast to specific source type is required
  const source = map.getSource('selection') as maplibregl.GeoJSONSource;
  if (!sw || !ne || !source) {
    if (source) source.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  source.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [sw.lng, sw.lat],
              [ne.lng, sw.lat],
              [ne.lng, ne.lat],
              [sw.lng, ne.lat],
              [sw.lng, sw.lat]
            ]
          ]
        },
        properties: {}
      }
    ]
  });
}

function clearSelection() {
  updateSelectionLayer(null, null);
}

function setupRectangularSelection() {
  const container = map.getContainer();

  container.addEventListener('mousedown', (e) => {
    if (!e.shiftKey) return;
    const rect = container.getBoundingClientRect();
    isSelecting = true;
    selectionStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    map.dragPan.disable();
    clearSelection();
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isSelecting || !selectionStart) return;
    const rect = container.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const minX = Math.min(selectionStart.x, currentX);
    const minY = Math.min(selectionStart.y, currentY);
    const maxX = Math.max(selectionStart.x, currentX);
    const maxY = Math.max(selectionStart.y, currentY);

    const sw = map.unproject([minX, maxY]);
    const ne = map.unproject([maxX, minY]);
    updateSelectionLayer(sw, ne);
  });

  document.addEventListener('mouseup', (e) => {
    if (!isSelecting || !selectionStart) return;
    isSelecting = false;
    map.dragPan.enable();

    const rect = container.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    const minX = Math.min(selectionStart.x, endX);
    const minY = Math.min(selectionStart.y, endY);
    const maxX = Math.max(selectionStart.x, endX);
    const maxY = Math.max(selectionStart.y, endY);

    if (maxX - minX < 10 || maxY - minY < 10) {
      clearSelection();
      return;
    }

    const sw = map.unproject([minX, maxY]);
    const ne = map.unproject([maxX, minY]);

    const allFeatures = map.queryRenderedFeatures(
      [
        [minX, minY],
        [maxX, maxY]
      ],
      { layers: ['photo-markers'] }
    );
    const features = allFeatures.filter((f) => {
      const geom = f.geometry as Point;
      const [lng, lat] = geom.coordinates;
      if (lng === undefined || lat === undefined) return false;
      return lng >= sw.lng && lng <= ne.lng && lat >= sw.lat && lat <= ne.lat;
    });

    if (features.length > 0) {
      const topCenterLngLat = map.unproject([(minX + maxX) / 2, minY]);
      if (features.length === 1) {
        clearSelection();
        const geom = features[0]!.geometry as Point;
        const props = features[0]!.properties as Record<string, unknown>;
        const index = props.index as number | undefined;
        if (index === undefined) return;
        showPopup({ index }, geom.coordinates as [number, number]);
      } else {
        showMultiPhotoPopup(
          features,
          [topCenterLngLat.lng, topCenterLngLat.lat],
          true
        );
        fitToSelectionWithPopup(sw, ne);
      }
    } else {
      clearSelection();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' && isSelecting) {
      isSelecting = false;
      clearSelection();
      map.dragPan.enable();
    }
  });

  document.addEventListener('keydown', (e) => {
    // Ignore if lightbox is active
    if (document.querySelector('.lightbox.active')) return;

    // Ignore if no popup
    if (!currentPopup) return;

    if (e.key === 'Escape') {
      currentPopup.remove();
      clearSelection();
      return;
    }

    // Navigation requires multiple photos
    if (clusterPhotos.length <= 1) return;

    if (e.key === 'ArrowRight') {
      const nextIndex = (currentGroupIndex + 1) % clusterPhotos.length;
      selectGroupPhoto(nextIndex);
      scrollToActiveThumbnail();
    } else if (e.key === 'ArrowLeft') {
      const prevIndex =
        (currentGroupIndex - 1 + clusterPhotos.length) % clusterPhotos.length;
      selectGroupPhoto(prevIndex);
      scrollToActiveThumbnail();
    }
  });
}

function fitToSelectionWithPopup(sw: maplibregl.LngLat, ne: maplibregl.LngLat) {
  setTimeout(() => {
    const popupEl = currentPopup?.getElement();
    const popupHeight = popupEl ? popupEl.offsetHeight : 350;
    const bounds = new maplibregl.LngLatBounds(sw, ne);
    map.fitBounds(bounds, {
      padding: { top: popupHeight + 20, bottom: 30, left: 20, right: 270 },
      duration: 300
    });
  }, 50);
}
