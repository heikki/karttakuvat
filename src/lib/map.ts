import type { FeatureCollection, Point } from 'geojson';
import maplibregl from 'maplibre-gl';
import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';
import { NightLayer } from 'maplibre-gl-nightlayer';

import { mapStyles } from './config';
import { addPendingEdit, state, subscribe } from './data';
import {
  getClusterPhotos,
  getCurrentPhotoUuid,
  getCurrentPopup,
  initPopupCallbacks,
  scrollToActiveThumbnail,
  selectGroupPhoto as selectGroupPhotoFromPopup,
  showPopup
} from './popup';
import {
  addSelectionLayer,
  initSelectionCallbacks,
  setupRectangularSelection
} from './selection';
import type { MapStyles } from './types';
import { formatDate, getThumbUrl, toUtcSortKey } from './utils';

// Declare window augmentation for map
declare global {
  interface Window {
    map?: maplibregl.Map;
  }
}

// Global map variable (local to module)
// eslint-disable-next-line @typescript-eslint/init-declarations -- map is initialized in initMap() which is called before any other usage
let map: maplibregl.Map;

function getMap(): maplibregl.Map {
  return map;
}

// Placement mode state
let placementPhotoIndex: number | null = null;

function showPlacementPanel(photoIndex: number) {
  const photo = state.filteredPhotos[photoIndex];
  if (photo === undefined) return;

  let panel = document.getElementById('placement-panel');
  if (panel === null) {
    panel = document.createElement('div');
    panel.id = 'placement-panel';
    document.body.appendChild(panel);
  }

  panel.innerHTML = `<img src="${getThumbUrl(photo)}" alt="" /><div class="placement-panel-info">${formatDate(photo.date, photo.tz)}</div><div class="placement-panel-hint">Click map to set location. Esc to cancel.</div>`;
  panel.classList.add('active');
}

function hidePlacementPanel() {
  const panel = document.getElementById('placement-panel');
  if (panel !== null) {
    panel.classList.remove('active');
  }
}

const markerLayers = [
  'photo-markers',
  'photo-markers-selected',
  'photo-markers-highlight-ring'
];

function setMarkerVisibility(visible: boolean) {
  const visibility = visible ? 'visible' : 'none';
  for (const id of markerLayers) {
    if (map.getLayer(id) !== undefined) {
      map.setLayoutProperty(id, 'visibility', visibility);
    }
  }
}

function exitPlacementMode() {
  placementPhotoIndex = null;
  map.getCanvas().classList.remove('crosshair');
  hidePlacementPanel();
  setMarkerVisibility(true);
}

function finishPlacement(photoIndex: number, lat: number, lon: number) {
  const photo = state.filteredPhotos[photoIndex];
  if (photo === undefined) return;

  addPendingEdit(photo.uuid, lat, lon);
  exitPlacementMode();
  showPopup({ index: photoIndex }, [lon, lat]);
}

export function enterPlacementMode(photoIndex: number) {
  // Close any open popup
  const popup = getCurrentPopup();
  if (popup !== null) {
    popup.remove();
  }

  placementPhotoIndex = photoIndex;
  map.getCanvas().classList.add('crosshair');
  showPlacementPanel(photoIndex);
  setMarkerVisibility(false);
}

function withGlobe(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    projection: { type: 'globe' },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0 }
  };
}

function createNightLayer(date: Date | null = null): NightLayer {
  return new NightLayer({
    date,
    opacity: 0.8,
    color: [0, 0, 0, 255],
    daytimeColor: [0, 0, 0, 0],
    twilightSteps: 0,
    updateInterval: 0
  });
}

let nightLayer = createNightLayer();
let nightLayerDate: Date | null = null;

function addNightLayer() {
  if (map.getLayer(nightLayer.id) !== undefined) {
    map.removeLayer(nightLayer.id);
  }
  nightLayer = createNightLayer(nightLayerDate);
  if (map.getLayer('photo-markers-selected') !== undefined) {
    map.addLayer(nightLayer, 'photo-markers-selected');
  } else {
    map.addLayer(nightLayer);
  }
}

let nightAnimationId: number | null = null;

let nightLayerAlbums: string[] = [];

export function updateSunPosition(
  dateStr: string,
  tz: string | null,
  albums?: string[],
  sequential?: boolean
) {
  if (dateStr === '') return;
  const targetDate = new Date(toUtcSortKey(dateStr, tz));
  if (isNaN(targetDate.getTime())) return;

  if (nightAnimationId !== null) {
    cancelAnimationFrame(nightAnimationId);
    nightAnimationId = null;
  }

  const prevAlbums = nightLayerAlbums;
  nightLayerAlbums = albums ?? [];

  const currentDate = nightLayerDate;
  if (currentDate === null) {
    nightLayerDate = targetDate;
    nightLayer.setDate(targetDate);
    map.triggerRepaint();
    return;
  }

  // Full transition only for sequential nav within same album
  const sharesAlbum = prevAlbums.some((a) => nightLayerAlbums.includes(a));
  const fullTransition = sequential === true && sharesAlbum;
  const fullDiffMs = Math.abs(targetDate.getTime() - currentDate.getTime());
  const isLongJump = !fullTransition || fullDiffMs > 86400000;
  const startTime = fullTransition
    ? currentDate.getTime()
    : new Date(targetDate).setHours(
        currentDate.getHours(),
        currentDate.getMinutes(),
        currentDate.getSeconds()
      );
  const endTime = targetDate.getTime();
  const days = fullDiffMs / 86400000;
  const duration = isLongJump ? Math.min(400 + days * 20, 1000) : 400;
  const animStart = performance.now();

  const NIGHT_OPACITY = 0.8;
  const animate = (now: number) => {
    const t = Math.min(1, (now - animStart) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t); // ease-in-out
    const interpolated = startTime + (endTime - startTime) * eased;
    const d = new Date(interpolated);
    nightLayerDate = d;
    nightLayer.setDate(d);
    // Darken daytime during long jumps, more for longer gaps
    if (isLongJump) {
      const days = fullDiffMs / 86400000;
      const strength = Math.min(days / 30, 1); // 0 at 1 day, 1 at 30+ days
      const mid = Math.sin(t * Math.PI);
      nightLayer.setDaytimeColor([0, 0, 0, Math.round(mid * strength * 200)]);
    }
    map.triggerRepaint();
    if (t < 1) {
      nightAnimationId = requestAnimationFrame(animate);
    } else {
      nightAnimationId = null;
    }
  };
  nightAnimationId = requestAnimationFrame(animate);
}

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: withGlobe(mapStyles().opentopomap as StyleSpecification),
    center: [29.52, 64.13],
    zoom: 10,
    boxZoom: false,
    keyboard: false
  });

  map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
  map.addControl(new maplibregl.GlobeControl(), 'bottom-right');
  map.addControl(
    new maplibregl.ScaleControl({ unit: 'metric' }),
    'bottom-left'
  );

  // Handle MapLibre internal errors gracefully
  map.on('error', () => {
    // Silently ignore MapLibre internal errors
  });

  // Expose map to window
  window.map = map;

  // Initialize callbacks for other modules
  initPopupCallbacks(highlightMarker, panToFitPopup, getMap, updateSunPosition);
  initSelectionCallbacks(getMap);

  map.on('load', () => {
    addPhotoLayers();
    addSelectionLayer();
    setupMarkerInteractions();
    addNightLayer();
    setupRectangularSelection();

    updateMapData();
    if (state.filteredPhotos.length > 0) {
      fitToPhotos();
    }
  });

  // Re-show popup when projection changes so it repositions correctly
  map.on('projectiontransition', () => {
    const popup = getCurrentPopup();
    if (popup === null) return;
    const uuid = getCurrentPhotoUuid();
    if (uuid === null) return;
    const index = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
    if (index === -1) return;
    const photo = state.filteredPhotos[index]!;
    const pending = state.pendingEdits.get(photo.uuid);
    const lon = pending === undefined ? (photo.lon ?? 0) : pending.lon;
    const lat = pending === undefined ? (photo.lat ?? 0) : pending.lat;
    showPopup({ index }, [lon, lat]);
  });

  subscribe(() => {
    if (map.isStyleLoaded() === true) {
      const uuid = getCurrentPhotoUuid();
      updateMapData();
      const popup = getCurrentPopup();
      if (popup !== null) {
        if (uuid !== null) {
          const newIndex = state.filteredPhotos.findIndex(
            (p) => p.uuid === uuid
          );
          if (newIndex !== -1) {
            const photo = state.filteredPhotos[newIndex]!;
            const pending = state.pendingEdits.get(photo.uuid);
            const lon = pending === undefined ? (photo.lon ?? 0) : pending.lon;
            const lat = pending === undefined ? (photo.lat ?? 0) : pending.lat;
            showPopup({ index: newIndex }, [lon, lat]);
            return;
          }
        }
        popup.remove();
      }
    }
  });

  // Placement mode: click to set location
  map.on('click', (e) => {
    if (placementPhotoIndex === null) return;

    if (state.filteredPhotos[placementPhotoIndex] === undefined) {
      exitPlacementMode();
      return;
    }

    e.preventDefault();
    finishPlacement(placementPhotoIndex, e.lngLat.lat, e.lngLat.lng);
  });

  // Esc to cancel placement mode
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && placementPhotoIndex !== null) {
      exitPlacementMode();
    }
  });
}

function updateMapData() {
  const source = map.getSource('photos');
  if (source === undefined) return;

  const geoSource = source as maplibregl.GeoJSONSource;
  geoSource.setData(createGeoJSON());
}

export function changeMapStyle(styleKey: string) {
  const style = mapStyles()[styleKey as keyof MapStyles] as
    | StyleSpecification
    | undefined;
  if (style === undefined) return;

  // Stop any ongoing animation to prevent MapLibre crash during style change
  map.stop();
  map.setStyle(withGlobe(style));
  void map.once('style.load', () => {
    addPhotoLayers();
    addSelectionLayer();
    setupMarkerInteractions();
    updateMapData();
    addNightLayer();
  });
}

function createGeoJSON(): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: state.filteredPhotos.map((photo, index) => {
      const pending = state.pendingEdits.get(photo.uuid);
      const lon = pending === undefined ? (photo.lon ?? 0) : pending.lon;
      const lat = pending === undefined ? (photo.lat ?? 0) : pending.lat;
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lon, lat]
        },
        properties: {
          index,
          lat,
          gps: photo.gps ?? 'none'
        }
      };
    })
  };
}

function addPhotoLayers() {
  for (const id of [
    'photo-markers-highlight-ring',
    'photo-markers-selected',
    'photo-markers'
  ]) {
    if (map.getLayer(id) !== undefined) map.removeLayer(id);
  }
  if (map.getSource('photos') !== undefined) map.removeSource('photos');

  map.addSource('photos', {
    type: 'geojson',
    data: createGeoJSON()
  });

  const markerPaint: maplibregl.CircleLayerSpecification['paint'] = {
    'circle-color': [
      'match',
      ['get', 'gps'],
      'exif',
      '#3b82f6',
      'user',
      '#22c55e',
      'inferred',
      '#f59e0b',
      '#9ca3af'
    ],
    'circle-radius': 8,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#fff',
    'circle-pitch-alignment': 'map'
  };

  map.addLayer({
    id: 'photo-markers',
    type: 'circle',
    source: 'photos',
    layout: {
      'circle-sort-key': [
        '-',
        ['*', -1000000, ['get', 'lat']],
        ['get', 'index']
      ]
    },
    paint: markerPaint
  });

  map.addLayer({
    id: 'photo-markers-selected',
    type: 'circle',
    source: 'photos',
    paint: markerPaint,
    filter: ['==', ['get', 'index'], -1]
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
}

let pulseAnimationId: number | null = null;

function startPulseAnimation() {
  if (pulseAnimationId !== null) return;
  const start = performance.now();
  const animate = (now: number) => {
    const t = ((now - start) % 1200) / 1200;
    const radius = 12 + 8 * t;
    const opacity = 0.8 - 0.8 * t;
    if (map.getLayer('photo-markers-highlight-ring') !== undefined) {
      map.setPaintProperty(
        'photo-markers-highlight-ring',
        'circle-radius',
        radius
      );
      map.setPaintProperty(
        'photo-markers-highlight-ring',
        'circle-stroke-opacity',
        opacity
      );
    }
    pulseAnimationId = requestAnimationFrame(animate);
  };
  pulseAnimationId = requestAnimationFrame(animate);
}

function stopPulseAnimation() {
  if (pulseAnimationId !== null) {
    cancelAnimationFrame(pulseAnimationId);
    pulseAnimationId = null;
  }
}

function highlightMarker(index: number | null) {
  const filter: FilterSpecification =
    index === null
      ? ['==', ['get', 'index'], -1]
      : ['==', ['get', 'index'], index];

  if (map.getLayer('photo-markers-selected') !== undefined) {
    map.setFilter('photo-markers-selected', filter);
  }
  if (map.getLayer('photo-markers-highlight-ring') !== undefined) {
    map.setFilter('photo-markers-highlight-ring', filter);
  }

  if (index === null) {
    stopPulseAnimation();
  } else {
    startPulseAnimation();
  }
}

function setupMarkerInteractions() {
  map.on('click', 'photo-markers', (e) => {
    // In placement mode, let the map-level click handler handle it
    if (placementPhotoIndex !== null) return;

    e.preventDefault();
    e.originalEvent.stopPropagation();

    if (e.features === undefined || e.features.length === 0) {
      return;
    }
    const feature = e.features[0]!;
    const clickedIndex = feature.properties.index as number | undefined;

    // Check if part of cluster
    const popup = getCurrentPopup();
    const clusterPhotos = getClusterPhotos();
    if (popup !== null && clusterPhotos.length > 1) {
      const groupIndex = clusterPhotos.findIndex(
        (p) => p._index === clickedIndex
      );
      if (groupIndex !== -1) {
        selectGroupPhotoFromPopup(groupIndex);
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
    if (placementPhotoIndex === null) {
      map.getCanvas().style.cursor = 'pointer';
    }
  });
  map.on('mouseleave', 'photo-markers', () => {
    if (placementPhotoIndex === null) {
      map.getCanvas().style.cursor = '';
    }
  });

  map.on('click', (e) => {
    // In placement mode, don't close popups on empty clicks
    if (placementPhotoIndex !== null) return;

    const features = map.queryRenderedFeatures(e.point, {
      layers: ['photo-markers']
    });
    if (features.length > 0) return;
    const selectionFeatures = map.queryRenderedFeatures(e.point, {
      layers: ['selection-fill']
    });
    if (selectionFeatures.length > 0) return;
    const popup = getCurrentPopup();
    if (popup !== null) {
      popup.remove();
    }
  });
}

function calculatePanOffset(
  mapRect: DOMRect,
  popupRect: DOMRect
): { panX: number; panY: number } {
  const padding = { top: 10, right: 260, bottom: 10, left: 10 };
  let panX = 0;
  let panY = 0;

  if (popupRect.top < mapRect.top + padding.top) {
    panY = popupRect.top - mapRect.top - padding.top;
  } else if (popupRect.bottom > mapRect.bottom - padding.bottom) {
    panY = popupRect.bottom - mapRect.bottom + padding.bottom;
  }

  if (popupRect.left < mapRect.left + padding.left) {
    panX = popupRect.left - mapRect.left - padding.left;
  } else if (popupRect.right > mapRect.right - padding.right) {
    panX = popupRect.right - mapRect.right + padding.right;
  }

  return { panX, panY };
}

function panToFitPopup(coords: [number, number]) {
  setTimeout(() => {
    const popup = getCurrentPopup();
    if (popup === null) return;

    // Guard against MapLibre crash when container has invalid dimensions
    const mapContainer = map.getContainer();
    if (mapContainer.clientWidth === 0 || mapContainer.clientHeight === 0) {
      return;
    }

    // Stop any ongoing animation before panning
    map.stop();

    const popupEl = popup.getElement() as HTMLElement | undefined;
    if (popupEl === undefined) return;
    const mapRect = mapContainer.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();
    const { panX, panY } = calculatePanOffset(mapRect, popupRect);

    if (panX !== 0 || panY !== 0) {
      try {
        map.panBy([panX, panY], { duration: 300 });
      } catch {
        // Silently ignore MapLibre internal errors
      }
    }
  }, 50);
}

export function fitToPhotos(animate = false, selectFirst = false) {
  if (state.filteredPhotos.length === 0) return;

  const bounds = new maplibregl.LngLatBounds();
  state.filteredPhotos.forEach((p) => bounds.extend([p.lon ?? 0, p.lat ?? 0]));

  const showFirstPopup = () => {
    if (!selectFirst) return;
    const photo = state.filteredPhotos[0];
    if (photo === undefined) return;
    const pending = state.pendingEdits.get(photo.uuid);
    const lon = pending === undefined ? (photo.lon ?? 0) : pending.lon;
    const lat = pending === undefined ? (photo.lat ?? 0) : pending.lat;
    showPopup({ index: 0 }, [lon, lat]);
  };

  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  if (sw.lng === ne.lng && sw.lat === ne.lat) {
    const center = bounds.getCenter();
    if (animate) {
      map.flyTo({ center: [center.lng, center.lat], zoom: 14, duration: 500 });
      void map.once('moveend', showFirstPopup);
    } else {
      map.setCenter([center.lng, center.lat]);
      map.setZoom(14);
      showFirstPopup();
    }
    return;
  }

  const isGlobe = map.getProjection().type === 'globe';
  map.fitBounds(bounds, {
    padding: {
      top: isGlobe ? 50 : 350,
      bottom: 40,
      left: 50,
      right: 270
    },
    maxZoom: 18,
    duration: animate ? 500 : 0
  });

  if (animate && selectFirst) {
    void map.once('moveend', showFirstPopup);
  } else {
    showFirstPopup();
  }
}

// Re-export for index.ts
export { selectGroupPhotoFromPopup as selectGroupPhoto };
