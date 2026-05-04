import type { FeatureCollection } from 'geojson';
import { customElement } from 'lit/decorators.js';
import type { GeoJSONSource, LayerSpecification } from 'maplibre-gl';

import * as data from '@common/data';
import * as edits from '@common/edits';
import selection from '@common/selection';
import { effect } from '@common/signals';
import type { Photo } from '@common/types';
import { toUtcSortKey } from '@common/utils';
import { viewState } from '@common/view-state';
import {
  MapFeatureElement,
  setLayersVisibility
} from '@components/map-view/api';

import { initRouteEdit } from './edit';
import { buildRouteLineFeatures, createEditLayers } from './helpers';
import {
  reconcileRouteWithAlbum,
  reorderRoutePhotoPoints,
  syncPhotoPoints
} from './reconcile';
import type { RouteData, RoutePoint, RouteSegment } from './types';

const lineLayout = {
  'visibility': 'none' as const,
  'line-cap': 'round' as const,
  'line-join': 'round' as const
};
const LAYERS: LayerSpecification[] = [
  {
    id: 'photo-route-outline',
    type: 'line',
    source: 'photo-route',
    paint: { 'line-color': 'rgba(0, 0, 0, 0.3)', 'line-width': 4 },
    layout: lineLayout
  },
  {
    id: 'photo-route-line',
    type: 'line',
    source: 'photo-route',
    paint: { 'line-color': '#60a5fa', 'line-width': 2 },
    layout: lineLayout
  }
];
const LAYER_IDS = LAYERS.map((l) => l.id);

function isVisible(): boolean {
  return viewState.routeVisible.get();
}

function getSortedLocatedPhotos(): Array<{
  photo: Photo;
  loc: { lat: number; lon: number };
  sortKey: string;
}> {
  const located: Array<{
    photo: Photo;
    loc: { lat: number; lon: number };
    sortKey: string;
  }> = [];
  for (const photo of data.filteredPhotos.get()) {
    const loc = edits.getEffectiveLocation(photo);
    if (loc === null) continue;
    if (photo.date === '') continue;
    located.push({
      photo,
      loc,
      sortKey: toUtcSortKey(edits.getEffectiveDate(photo), photo.tz)
    });
  }
  located.sort((a, b) =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
  );
  return located;
}

async function loadSavedRoute(album: string): Promise<RouteData | null> {
  try {
    const resp = await fetch(`/api/albums/${encodeURIComponent(album)}/route`);
    if (!resp.ok) return null;
    return (await resp.json()) as RouteData;
  } catch {
    return null;
  }
}

@customElement('map-route')
export class MapRoute extends MapFeatureElement {
  private routeData: RouteData | null = null;
  private currentAlbum = 'all';

  override firstUpdated() {
    const map = this.api.map;
    initRouteEdit(map, this);
    this.addLayers();
    createEditLayers(map);

    // Edit mode owns rendering, so display layers hide while editing.
    effect(() => {
      const show =
        isVisible() && selection.interactionMode.get() !== 'route-edit';
      setLayersVisibility(this.api.map, LAYER_IDS, show);
    });

    // On flip-on, run the album-aware load/build (off is handled above).
    let lastVisible = !isVisible();
    effect(() => {
      const v = isVisible();
      if (v === lastVisible) return;
      lastVisible = v;
      if (v) this.onRouteShown();
    });

    effect(() => {
      data.filteredPhotos.get();
      edits.pendingCoords.get();
      edits.pendingTimeOffsets.get();
      if (isVisible()) this.onPhotosChanged();
    });
  }

  /** Get the current route data (if any). */
  getData(): RouteData | null {
    return this.routeData;
  }

  /** Set route data and refresh the display source. */
  setData(route: RouteData | null): void {
    this.routeData = route;
    if (route === null) {
      this.updateRoute();
    } else {
      this.applyRouteData(route);
    }
  }

  /** Build the default straight-line route from current filtered photos. */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- pure builder, but groups with the rest of the route API
  buildDefault(): RouteData | null {
    const located = getSortedLocatedPhotos();
    if (located.length < 2) return null;

    const points: RoutePoint[] = located.map((p) => ({
      type: 'photo' as const,
      uuid: p.photo.uuid,
      lon: p.loc.lon,
      lat: p.loc.lat
    }));

    const segments: RouteSegment[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({
        method: 'straight',
        geometry: [
          [points[i]!.lon, points[i]!.lat],
          [points[i + 1]!.lon, points[i + 1]!.lat]
        ]
      });
    }

    return { points, segments };
  }

  /** Save route to server. */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- groups with the rest of the route API
  async save(album: string, route: RouteData): Promise<void> {
    await fetch(`/api/albums/${encodeURIComponent(album)}/route`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(route)
    });
  }

  private addLayers(): void {
    const map = this.api.map;
    const empty: FeatureCollection = {
      type: 'FeatureCollection',
      features: []
    };
    map.addSource('photo-route', { type: 'geojson', data: empty });
    for (const spec of LAYERS) map.addLayer(spec);
    if (isVisible()) {
      setLayersVisibility(map, LAYER_IDS, true);
      this.updateRoute();
    }
  }

  private onPhotosChanged(): void {
    const album = data.filters.get().album;
    if (album === this.currentAlbum) {
      this.updateRoute();
      return;
    }
    // Album changed — clear old route data and reload for new album
    this.currentAlbum = album;
    this.routeData = null;
    if (album === 'all') {
      this.updateRoute();
      return;
    }
    void this.loadAndApplyRoute(album);
  }

  private onRouteShown(): void {
    const album = data.filters.get().album;
    if (album !== this.currentAlbum) {
      this.currentAlbum = album;
      this.routeData = null;
    }
    if (album === 'all') {
      this.updateRoute();
      return;
    }
    if (this.routeData !== null) {
      this.reconcileAndApply(album, this.routeData);
      return;
    }
    void this.loadAndApplyRoute(album);
  }

  /**
   * Reconcile route data against current album membership/locations/dates,
   * apply to the display source, and persist if structure changed and no
   * edits are pending.
   */
  private reconcileAndApply(album: string, route: RouteData): void {
    const albumPhotos = data.photos
      .get()
      .filter((p) => p.albums.includes(album));
    const changed = reconcileRouteWithAlbum(route, albumPhotos);
    this.routeData = route;
    this.applyRouteData(route);
    if (changed && edits.editCount.get() === 0) {
      void this.save(album, route);
    }
  }

  private async loadAndApplyRoute(album: string): Promise<void> {
    const route = await loadSavedRoute(album);
    if (data.filters.get().album !== album || !isVisible()) return;
    if (route === null) {
      this.updateRoute();
      return;
    }
    this.reconcileAndApply(album, route);
  }

  private applyRouteData(route: RouteData): void {
    const src = this.api.map.getSource<GeoJSONSource>('photo-route');
    if (src === undefined) return;
    src.setData({
      type: 'FeatureCollection',
      features: buildRouteLineFeatures(route)
    });
  }

  private refreshSavedRoute(route: RouteData): void {
    const synced = syncPhotoPoints(route);
    const reordered = reorderRoutePhotoPoints(route);
    this.applyRouteData(route);
    if (!synced && !reordered) return;
    if (edits.editCount.get() > 0) return;
    const album = data.filters.get().album;
    if (album !== 'all') void this.save(album, route);
  }

  private updateRoute(): void {
    const src = this.api.map.getSource<GeoJSONSource>('photo-route');
    if (src === undefined) return;

    if (this.routeData !== null) {
      this.refreshSavedRoute(this.routeData);
      return;
    }

    const album = data.filters.get().album;
    const route = album === 'all' ? null : this.buildDefault();
    if (route === null) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    this.applyRouteData(route);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-route': MapRoute;
  }
}
