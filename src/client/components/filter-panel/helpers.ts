import { html } from 'lit';

import type { Photo } from '@common/types';
import { getYear } from '@common/utils';

export const DEFAULT_GPS = ['exif', 'inferred', 'user'];
export const DEFAULT_MEDIA = ['photo', 'video'];

export function cascade(
  photos: Photo[],
  requested: { year: string; album: string; camera: string }
): {
  album: string;
  camera: string;
  albumOptions: string[];
  cameraOptions: string[];
  filtered: Photo[];
} {
  const yearPhotos =
    requested.year === 'all'
      ? photos
      : photos.filter((p) => getYear(p) === requested.year);

  const albumOptions = [...new Set(yearPhotos.flatMap((p) => p.albums))].sort();
  const album =
    requested.album !== 'all' && !albumOptions.includes(requested.album)
      ? 'all'
      : requested.album;

  const albumPhotos =
    album === 'all'
      ? yearPhotos
      : yearPhotos.filter((p) => p.albums.includes(album));

  const cameraOptions = [
    ...new Set(albumPhotos.map((p) => p.camera ?? '(unknown)'))
  ].sort();
  const camera =
    requested.camera !== 'all' && !cameraOptions.includes(requested.camera)
      ? 'all'
      : requested.camera;

  const filtered =
    camera === 'all'
      ? albumPhotos
      : albumPhotos.filter((p) => (p.camera ?? '(unknown)') === camera);

  return { album, camera, albumOptions, cameraOptions, filtered };
}

export function renderSelect(
  label: string,
  options: string[],
  value: string,
  onChange: (e: Event) => void
) {
  return html`
    <label>${label}</label>
    <select @change=${onChange}>
      <option value="all" ?selected=${value === 'all'}>All</option>
      ${options.map(
        (o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`
      )}
    </select>
  `;
}

export function renderFilterBtns(
  active: string[],
  items: Array<{ value: string; label: string; color?: string }>,
  onClick: (v: string) => void,
  onDbl: (v: string) => void
) {
  return html`
    <div class="filter-buttons">
      ${items.map(
        (i) => html`
          <button
            class="filter-btn ${active.includes(i.value) ? 'active' : ''}"
            style=${i.color === undefined ? '' : `--btn-color: ${i.color}`}
            @click=${() => {
              onClick(i.value);
            }}
            @dblclick=${() => {
              onDbl(i.value);
            }}
          >
            ${i.label}
          </button>
        `
      )}
    </div>
  `;
}

export function renderStyleBtns(
  items: Array<{ style: string; label: string }>,
  active: string,
  onClick: (s: string) => void
) {
  return html`
    <div class="map-type-buttons">
      ${items.map(
        (i) => html`
          <button
            class="map-type-btn ${i.style === active ? 'active' : ''}"
            @click=${() => {
              onClick(i.style);
            }}
          >
            ${i.label}
          </button>
        `
      )}
    </div>
  `;
}
