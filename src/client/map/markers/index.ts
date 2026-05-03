import type { Map as MapGL, MapLayerMouseEvent, Point } from 'maplibre-gl';

import { state, subscribe } from '@common/data';
import { ChangeMarkerStyleEvent } from '@common/events';
import type { MarkerLayer } from '@common/types';

import * as selection from '../selection';
import { ClassicLayer } from './classic';
import { PointsLayer } from './points';

const markerStyles: Record<string, () => MarkerLayer> = {
  points: () => new PointsLayer(),
  classic: () => new ClassicLayer()
};

// eslint-disable-next-line @typescript-eslint/init-declarations -- set in initMarkers before any other usage
let map: MapGL;
let currentMarkerStyle = 'classic';
let currentLayer: MarkerLayer | null = null;
let interactionCleanup: (() => void) | null = null;

export function initMarkers(m: MapGL): void {
  map = m;

  map.on('load', () => {
    install();
    bindInteractions();
    applySelection();
  });

  document.addEventListener(ChangeMarkerStyleEvent.type, (e) => {
    if (!(e.style in markerStyles)) return;
    currentMarkerStyle = e.style;
    if (currentLayer === null) return;
    install();
    bindInteractions();
    applySelection();
  });

  selection.subscribe(applySelection);

  subscribe(() => {
    currentLayer?.setMarkers(state.filteredPhotos);
  });
}

export function isClickOnMarker(point: Point): boolean {
  const id = currentLayer?.id;
  if (id === undefined || map.getLayer(id) === undefined) return false;
  return map.queryRenderedFeatures(point, { layers: [id] }).length > 0;
}

export function getMarkerRadius(zoom: number): number {
  return currentLayer?.markerRadius(zoom) ?? 0;
}

function applySelection(): void {
  if (currentLayer === null) return;
  const mode = selection.getMode();
  currentLayer.toggle(mode !== 'placement');
  if (mode === 'popup') {
    currentLayer.highlight(selection.getPhoto() ?? null);
  } else {
    currentLayer.highlight(null);
  }
}

function install(): void {
  currentLayer?.uninstall();
  currentLayer = markerStyles[currentMarkerStyle]!();
  currentLayer.install(map, state.filteredPhotos);
}

function bindInteractions(): void {
  interactionCleanup?.();

  const layerId = currentLayer?.id;
  if (layerId === undefined) return;

  const canvas = map.getCanvas();

  const onLayerClick = (e: MapLayerMouseEvent) => {
    if (selection.getMode() === 'placement') return;
    e.preventDefault();
    e.originalEvent.stopPropagation();
    if (e.features === undefined || e.features.length === 0) return;
    const feature = e.features[0]!;
    const clickedIndex = feature.properties.index as number | undefined;
    if (clickedIndex === undefined) return;
    const photo = state.filteredPhotos[clickedIndex];
    if (photo === undefined) return;
    selection.openPopup(photo.uuid);
  };

  const onMouseEnter = () => {
    if (selection.getMode() !== 'placement') canvas.style.cursor = 'pointer';
  };
  const onMouseLeave = () => {
    if (selection.getMode() !== 'placement') canvas.style.cursor = '';
  };

  map.on('click', layerId, onLayerClick);
  map.on('mouseenter', layerId, onMouseEnter);
  map.on('mouseleave', layerId, onMouseLeave);

  interactionCleanup = () => {
    map.off('click', layerId, onLayerClick);
    map.off('mouseenter', layerId, onMouseEnter);
    map.off('mouseleave', layerId, onMouseLeave);
  };
}
