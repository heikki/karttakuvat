import type { Map as MapGL, MapLayerMouseEvent } from 'maplibre-gl';

import * as data from '@common/data';
import * as edits from '@common/edits';
import { effect } from '@common/signals';
import type { MarkerLayer } from '@common/types';
import { viewState } from '@common/view-state';

import selection from '../selection';
import { ClassicLayer } from './classic';
import { PointsLayer } from './points';

const markerStyles: Record<string, () => MarkerLayer> = {
  points: () => new PointsLayer(),
  classic: () => new ClassicLayer()
};

// eslint-disable-next-line @typescript-eslint/init-declarations -- set in init before any other usage
let map: MapGL;
let currentMarkerStyle = 'classic';
let currentLayer: MarkerLayer | null = null;
let interactionCleanup: (() => void) | null = null;

function init(m: MapGL): void {
  map = m;

  map.on('load', () => {
    install();
    bindInteractions();
    refreshView();
  });

  effect(() => {
    const style = viewState.markerStyle.get();
    if (!(style in markerStyles)) return;
    if (style === currentMarkerStyle) return;
    currentMarkerStyle = style;
    if (currentLayer === null) return;
    install();
    bindInteractions();
    refreshView();
  });

  effect(() => {
    edits.pendingCoords.get();
    selection.selectedPhotoUuid.get();
    selection.interactionMode.get();
    refreshView();
  });
}

function getRadius(zoom: number): number {
  return currentLayer?.markerRadius(zoom) ?? 0;
}

function refreshView(): void {
  if (currentLayer === null) return;
  const mode = selection.interactionMode.get();
  currentLayer.setView({
    photos: data.filteredPhotos.get(),
    selectedPhoto: selection.isPopupOpen()
      ? (selection.getPhoto() ?? null)
      : null,
    hidden: mode === 'placement'
  });
}

function install(): void {
  currentLayer?.uninstall();
  currentLayer = markerStyles[currentMarkerStyle]!();
  currentLayer.install(map);
}

function bindInteractions(): void {
  interactionCleanup?.();

  const layerId = currentLayer?.id;
  if (layerId === undefined) return;

  const canvas = map.getCanvas();

  const onLayerClick = (e: MapLayerMouseEvent) => {
    if (selection.interactionMode.get() === 'placement') return;
    e.preventDefault();
    e.originalEvent.stopPropagation();
    if (e.features === undefined || e.features.length === 0) return;
    const feature = e.features[0]!;
    const clickedIndex = feature.properties.index as number | undefined;
    if (clickedIndex === undefined) return;
    const photo = data.filteredPhotos.get()[clickedIndex];
    if (photo === undefined) return;
    selection.selectPhoto(photo.uuid);
  };

  const onMouseEnter = () => {
    if (selection.interactionMode.get() !== 'placement') {
      canvas.style.cursor = 'pointer';
    }
  };
  const onMouseLeave = () => {
    if (selection.interactionMode.get() !== 'placement') {
      canvas.style.cursor = '';
    }
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

export default { init, getRadius };
