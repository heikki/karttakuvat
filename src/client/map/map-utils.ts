import turfDistance from '@turf/distance';
import { point } from '@turf/helpers';
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

/** Total distance along a coordinate path in kilometers. */
function computePathDistance(coords: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += turfDistance(point(coords[i - 1]!), point(coords[i]!), {
      units: 'kilometers'
    });
  }
  return total;
}

export default { setLayersVisibility, computePathDistance };
