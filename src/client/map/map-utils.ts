import type { Map as MapGL } from 'maplibre-gl';

/** Set visibility on multiple layers at once. */
function setLayersVisibility(
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

export default { setLayersVisibility };
