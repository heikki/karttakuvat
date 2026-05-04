import { consume, createContext } from '@lit/context';
import { LitElement } from 'lit';
import type { Map as MapGL } from 'maplibre-gl';

/**
 * Public, in-tree map API consumed by sibling map features (via the
 * `mapContext` provided by `<map-view>`) and by `<map-view>` itself
 * (which implements it). External callers — `actions.ts`, panels —
 * reach the same surface via `document.querySelector('map-view')`.
 *
 * Keep this narrow: each entry exists because some specific cross-
 * feature interaction needs it. Don't expose feature elements wholesale.
 */
export interface MapApi {
  /** The MapLibre map instance. Valid only after the load event fires. */
  readonly map: MapGL;

  /** Camera-fit the current filtered photos. */
  fitToPhotos: (animate?: boolean, selectFirst?: boolean) => void;

  /** Reload GPX tracks for the current album. */
  reloadGpx: () => void;

  /** Force-remount the photo popup (e.g. after a basemap swap). */
  forceRemountPopup: () => void;

  /** Current popup's root DOM element, if mounted. */
  popupElement: () => HTMLElement | undefined;

  /** Marker radius at a given zoom level (used by popup offset). */
  markerRadius: (zoom: number) => number;

  /** Open the current selection (or map center) in an external map app. */
  openExternal: (target: 'apple' | 'google') => void;
}

export const mapContext = createContext<MapApi>(Symbol('map-api'));

/**
 * Base class for `<map-*>` feature elements that live as children of
 * `<map-view>`. Centralises the two pieces every feature shares:
 *
 * - `@consume(mapContext) protected api: MapApi` — the typed handle to
 *   the map and its sibling features.
 * - `createRenderRoot` returning `this` — features render into light
 *   DOM (they're headless or DOM-positional only). Shadow DOM is not
 *   needed and would block their CSS from inheriting from the page.
 *
 * Subclasses define their lifecycle in `firstUpdated` and read state
 * via `this.api`.
 */
export abstract class MapFeatureElement extends LitElement {
  @consume({ context: mapContext }) protected api!: MapApi;

  protected override createRenderRoot() {
    return this;
  }
}

/** Set visibility on multiple layers at once. */
export function setLayersVisibility(
  map: MapGL,
  layerIds: string[],
  visible: boolean
): void {
  const v = visible ? 'visible' : 'none';
  for (const id of layerIds) {
    if (map.getLayer(id) !== undefined) {
      map.setLayoutProperty(id, 'visibility', v);
    }
  }
}
