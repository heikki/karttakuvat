import type { Map as MapGL } from 'maplibre-gl';

import type { RouteSegment } from './photo-route';

/** Distance from a point to a polyline (in whatever coordinate space the inputs are). */
export function distToPolyline(
  px: number,
  py: number,
  coords: Array<[number, number]>
): number {
  let minDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i]!;
    const [bx, by] = coords[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

interface SegmentPopupOpts {
  map: MapGL;
  lngLat: [number, number];
  currentMethod: RouteSegment['method'];
  onSelect: (method: RouteSegment['method']) => void;
}

/** Create the segment routing method popup element. */
export function createSegmentPopup(opts: SegmentPopupOpts): HTMLElement {
  const px = opts.map.project(opts.lngLat);

  const el = document.createElement('div');
  el.className = 'route-edit-popup';
  el.innerHTML = [
    '<button data-method="straight">Straight</button>',
    '<button data-method="driving">Drive</button>',
    '<button data-method="walking">Walk</button>',
    '<button data-method="hiking">Hike</button>',
    '<button data-method="cycling">Cycle</button>'
  ].join('');

  el.style.cssText =
    `position:absolute;left:${px.x}px;top:${px.y}px;transform:translate(-50%,-100%) translateY(-8px);` +
    'background:rgba(44,44,46,0.95);border-radius:8px;padding:4px;display:flex;gap:2px;z-index:1500;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.5)';

  const buttons = Array.from(el.querySelectorAll('button'));
  for (const btn of buttons) {
    btn.style.cssText =
      'background:none;border:none;color:#e5e5e7;padding:6px 10px;border-radius:6px;' +
      'font:12px/1 -apple-system,sans-serif;cursor:pointer;white-space:nowrap';
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255,255,255,0.1)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'none';
    });
    btn.addEventListener('click', (ev: MouseEvent) => {
      ev.stopPropagation();
      opts.onSelect(btn.dataset.method as RouteSegment['method']);
    });
  }

  // Highlight current method
  const activeBtn = el.querySelector<HTMLElement>(
    `[data-method="${opts.currentMethod}"]`
  );
  if (activeBtn !== null) {
    activeBtn.style.background = 'rgba(96,165,250,0.3)';
  }

  return el;
}
