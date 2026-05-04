import turfDistance from '@turf/distance';
import { point } from '@turf/helpers';
import { customElement } from 'lit/decorators.js';
import type {
  GeoJSONSource,
  LayerSpecification,
  MapMouseEvent
} from 'maplibre-gl';

import selection from '@common/selection';
import { effect } from '@common/signals';
import {
  MapFeatureElement,
  setLayersVisibility
} from '@components/map-view/api';

const SOURCES = ['measure-points', 'measure-line'] as const;
const LAYERS: LayerSpecification[] = [
  {
    id: 'measure-line-layer',
    type: 'line',
    source: 'measure-line',
    paint: {
      'line-color': '#ff4444',
      'line-width': 2,
      'line-dasharray': [3, 2]
    },
    layout: { visibility: 'none' }
  },
  {
    id: 'measure-points-layer',
    type: 'circle',
    source: 'measure-points',
    paint: {
      'circle-radius': 6,
      'circle-color': '#ff4444',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff'
    },
    layout: { visibility: 'none' }
  }
];
const LAYER_IDS = LAYERS.map((l) => l.id);

function isActive(): boolean {
  return selection.interactionMode.get() === 'measure';
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') selection.interactionMode.set('idle');
}

function computeDistance(coords: ReadonlyArray<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += turfDistance(point(coords[i - 1]!), point(coords[i]!), {
      units: 'kilometers'
    });
  }
  return total;
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

@customElement('map-measure')
export class MapMeasure extends MapFeatureElement {
  private readonly coords: Array<[number, number]> = [];
  private overlay: HTMLElement | null = null;
  private readonly onMapClick = (e: MapMouseEvent): void => {
    // Click on existing measure point removes it.
    const features = this.api.map.queryRenderedFeatures(e.point, {
      layers: ['measure-points-layer']
    });
    if (features.length > 0) {
      const idx = features[0]!.properties.index as number;
      this.coords.splice(idx, 1);
      this.updateSources();
      return;
    }

    if (e.defaultPrevented) return;

    this.coords.push([e.lngLat.lng, e.lngLat.lat]);
    this.updateSources();
  };

  static toggle(): void {
    selection.interactionMode.set(isActive() ? 'idle' : 'measure');
  }

  override firstUpdated() {
    this.addLayers();

    let wasActive = false;
    effect(() => {
      const active = isActive();
      if (active === wasActive) return;
      wasActive = active;
      if (active) this.onEnter();
      else this.onExit();
    });
  }

  private addLayers(): void {
    const map = this.api.map;
    for (const id of SOURCES) {
      map.addSource(id, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    for (const spec of LAYERS) map.addLayer(spec);
    if (isActive()) {
      setLayersVisibility(map, LAYER_IDS, true);
    }
  }

  private updateSources(): void {
    const pointSource = this.api.map.getSource<GeoJSONSource>('measure-points');
    if (pointSource !== undefined) {
      pointSource.setData({
        type: 'FeatureCollection',
        features: this.coords.map((c, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: c },
          properties: { index: i }
        }))
      });
    }

    const lineSource = this.api.map.getSource<GeoJSONSource>('measure-line');
    if (lineSource !== undefined) {
      lineSource.setData(
        this.coords.length >= 2
          ? {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: this.coords },
              properties: {}
            }
          : { type: 'FeatureCollection', features: [] }
      );
    }

    this.updateOverlay();
  }

  private ensureOverlay(): void {
    if (this.overlay !== null) return;
    this.overlay = document.createElement('div');
    this.overlay.className = 'measure-overlay';
    document.body.appendChild(this.overlay);
  }

  private updateOverlay(): void {
    if (this.overlay === null) return;
    if (this.coords.length < 2) {
      this.overlay.textContent =
        this.coords.length === 0
          ? 'Click map to add points'
          : 'Click to add more points';
      return;
    }
    this.overlay.textContent = formatDistance(computeDistance(this.coords));
  }

  private removeOverlay(): void {
    if (this.overlay !== null) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  private onEnter(): void {
    this.coords.length = 0;
    this.api.map.getCanvas().classList.add('crosshair');
    setLayersVisibility(this.api.map, LAYER_IDS, true);
    this.updateSources();
    this.ensureOverlay();
    this.updateOverlay();
    this.api.map.on('click', this.onMapClick);
    document.addEventListener('keydown', onKeyDown);
  }

  private onExit(): void {
    this.coords.length = 0;
    this.api.map.getCanvas().classList.remove('crosshair');
    this.updateSources();
    setLayersVisibility(this.api.map, LAYER_IDS, false);
    this.removeOverlay();
    this.api.map.off('click', this.onMapClick);
    document.removeEventListener('keydown', onKeyDown);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-measure': MapMeasure;
  }
}
