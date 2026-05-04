import type { Map as MapGL, Popup } from 'maplibre-gl';

/**
 * Compute the radial-gradient mask that hides the popup behind the
 * globe in globe projection. Skips the four style writes when the
 * inputs are unchanged via `lastKey`. Returns the new key — the caller
 * tracks it across calls so we don't reapply identical styles every
 * render frame.
 */
export function applyGlobeMask(
  map: MapGL,
  popup: Popup,
  lastKey: string
): string {
  const el = popup.getElement() as HTMLElement | undefined;
  if (el === undefined) return lastKey;

  if (map.getProjection().type !== 'globe') {
    if (lastKey !== 'none') el.style.maskImage = '';
    return 'none';
  }

  const occluded = map.transform.isLocationOccluded(popup.getLngLat());
  if (!occluded) {
    if (lastKey !== 'visible') el.style.maskImage = '';
    return 'visible';
  }

  const container = map.getContainer();
  const globeCx = container.clientWidth / 2;
  const globeCy = container.clientHeight / 2;

  // Screen-space globe silhouette radius.
  // For sphere of radius R at camera distance D and focal length f (pixels):
  //   silhouette radius = f * R / sqrt(D² - R²)
  const t = map.transform as {
    worldSize: number;
    cameraToCenterDistance: number;
  };
  const R: number =
    t.worldSize /
    (2.0 * Math.PI) /
    Math.cos((map.getCenter().lat * Math.PI) / 180);
  const f: number = t.cameraToCenterDistance;
  const D = f + R;
  const r = (f * R) / Math.sqrt(D * D - R * R);

  // The mask gradient is positioned in the popup's box; compensate for the
  // popup's CSS-transform offset relative to the map container.
  const mapRect = container.getBoundingClientRect();
  const popupRect = el.getBoundingClientRect();
  const cx = globeCx - (popupRect.left - mapRect.left);
  const cy = globeCy - (popupRect.top - mapRect.top);
  const maskSize = Math.max(container.clientWidth, container.clientHeight) * 3;

  const key = `${r.toFixed(1)}:${cx.toFixed(0)}:${cy.toFixed(0)}:${maskSize}`;
  if (key === lastKey) return key;

  const half = maskSize / 2;
  el.style.maskImage = `radial-gradient(circle ${r}px at center, transparent ${r}px, black ${r}px)`;
  el.style.maskSize = `${maskSize}px ${maskSize}px`;
  el.style.maskPosition = `${cx - half}px ${cy - half}px`;
  el.style.maskRepeat = 'no-repeat';
  return key;
}
