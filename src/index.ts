import {
  applyFilters,
  clearPendingEdits,
  copyLocation,
  getPendingEdits,
  getPendingTimeEdits,
  loadPhotos,
  state,
  subscribe,
  subscribeEdits
} from './lib/data';
import {
  changeMapStyle,
  enterPlacementMode,
  fitToPhotos,
  initMap,
  selectGroupPhoto
} from './lib/map';
import {
  adjustTime,
  applyManualDate,
  copyDateFromPopup,
  copyLocationFromPopup,
  getClusterPhotos,
  getCurrentGroupIndex,
  getCurrentPhotoUuid,
  getCurrentPopup,
  getCurrentSinglePhotoIndex,
  handleDateInputKey,
  isDateEditMode,
  navigateSinglePhoto,
  pasteDateToPhoto,
  pasteLocation,
  showPopup,
  toggleDateEdit
} from './lib/popup';
import {
  hideLightbox,
  initUI,
  isLightboxActive,
  repopulateSelect,
  setLightboxNavigateCallback,
  showGroupLightbox,
  showLightbox,
  updatePendingEdits,
  updateStats
} from './lib/ui';
import { getYear } from './lib/utils';

declare global {
  interface Window {
    selectGroupPhoto: typeof selectGroupPhoto;
    showLightbox: typeof showLightbox;
    showGroupLightbox: typeof showGroupLightbox;
    enterPlacementMode: typeof enterPlacementMode;
    copyLocation: typeof copyLocation;
    copyLocationFromPopup: typeof copyLocationFromPopup;
    adjustTime: typeof adjustTime;
    pasteLocation: typeof pasteLocation;
    copyDateFromPopup: typeof copyDateFromPopup;
    pasteDateToPhoto: typeof pasteDateToPhoto;
    toggleDateEdit: typeof toggleDateEdit;
    applyManualDate: typeof applyManualDate;
    handleDateInputKey: typeof handleDateInputKey;
    showMetadata: (uuid: string) => void;
  }
}

// Note: map.ts might need to call updateLightboxGroup.
// Ideally map.ts is updated to import updateLightboxGroup and call it in showMultiPhotoPopup.
// I will just monkey-patch it here or update map.ts in next step if needed.
// BUT WAIT: map.ts logic is already written.
// map.ts generates HTML onclick="window.showGroupLightbox(0)".
// map.ts has `clusterPhotos` local variable.
// ui.ts has `currentGroupPhotos` local variable.
// I need to sync them.
// I should have updated map.ts to call `updateLightboxGroup` when creating the popup.
// I cannot easily edit map.ts again inside this thought block.
// Alternative: `window.showGroupLightbox` wrapper in index.ts that pulls from map?
// No, map does not expose `clusterPhotos`.

// Correct fix: Update `map.ts` to export `getClusterPhotos`.
// Then in `index.ts`:
// (window as any).showGroupLightbox = (index) => {
//    updateLightboxGroup(getClusterPhotos());
//    showGroupLightbox(index);
// }

// Let's modify map.ts to export getClusterPhotos.
// Actually, I can just update map.ts one more time quickly.
// OR: I can assume that `selectGroupPhoto` in map.ts (called by thumbnail click)
// can be hooked?
// `selectGroupPhoto` is exported.
// But `showGroupLightbox` acts on `currentPopup`.

// Let's assume for now that I need to update map.ts to call updateLightboxGroup.
// Im already 10 tool calls deep in this turn? No.
// I'll update map.ts next.

// For now write index.ts assuming exports exist.

// Keyboard shortcuts (capture phase to intercept before focused elements)
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && isDateEditMode()) {
      e.preventDefault();
      toggleDateEdit();
      return;
    }
    if (e.key !== ' ') return;
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (isLightboxActive()) {
      e.preventDefault();
      e.stopPropagation();
      hideLightbox();
      return;
    }
    const cluster = getClusterPhotos();
    if (cluster.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      showGroupLightbox(getCurrentGroupIndex());
      return;
    }
    const idx = getCurrentSinglePhotoIndex();
    if (idx !== null) {
      e.preventDefault();
      e.stopPropagation();
      showLightbox(idx);
    }
  },
  true
);

// Sync lightbox navigation to map marker selection
setLightboxNavigateCallback((mode, index) => {
  if (mode === 'group') {
    selectGroupPhoto(index);
  } else {
    navigateSinglePhoto(index);
  }
});

// Expose global functions for HTML access
window.selectGroupPhoto = selectGroupPhoto;
window.showLightbox = showLightbox;
window.showGroupLightbox = showGroupLightbox;
window.enterPlacementMode = enterPlacementMode;
window.copyLocation = copyLocation;
window.copyLocationFromPopup = copyLocationFromPopup;
window.adjustTime = adjustTime;
window.pasteLocation = pasteLocation;
window.copyDateFromPopup = copyDateFromPopup;
window.pasteDateToPhoto = pasteDateToPhoto;
window.toggleDateEdit = toggleDateEdit;
window.applyManualDate = applyManualDate;
window.handleDateInputKey = handleDateInputKey;
window.showMetadata = showMetadata;

// --- Metadata modal ---
function escapeHtml(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatSimpleValue(value: boolean | string | number): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    return value === '' ? '<em>—</em>' : escapeHtml(value);
  }
  return String(value);
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '<em>—</em>';
  if (
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return formatSimpleValue(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '<em>—</em>';
    return value
      .map((v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join(', ');
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value, null, 2);
    return `<details><summary>object</summary><pre style="font-size:11px;white-space:pre-wrap">${escapeHtml(json)}</pre></details>`;
  }
  // Unreachable for known input types, but satisfies exhaustive return
  return '';
}

const METADATA_FIELDS: Array<[string, string]> = [
  ['filename', 'Filename'],
  ['original_filename', 'Original filename'],
  ['date', 'Date'],
  ['date_added', 'Date added'],
  ['date_modified', 'Date modified'],
  ['title', 'Title'],
  ['description', 'Description'],
  ['keywords', 'Keywords'],
  ['albums', 'Albums'],
  ['persons', 'Persons'],
  ['labels', 'Labels'],
  ['ai_caption', 'AI caption'],
  ['width', 'Width'],
  ['height', 'Height'],
  ['original_filesize', 'File size'],
  ['uti', 'UTI'],
  ['latitude', 'Latitude'],
  ['longitude', 'Longitude'],
  ['place', 'Place'],
  ['favorite', 'Favorite'],
  ['hidden', 'Hidden'],
  ['ismovie', 'Video'],
  ['live_photo', 'Live Photo'],
  ['hdr', 'HDR'],
  ['panorama', 'Panorama'],
  ['selfie', 'Selfie'],
  ['portrait', 'Portrait'],
  ['burst', 'Burst'],
  ['screenshot', 'Screenshot'],
  ['slow_mo', 'Slow-mo'],
  ['time_lapse', 'Time-lapse'],
  ['hasadjustments', 'Has adjustments'],
  ['shared', 'Shared'],
  ['orientation', 'Orientation'],
  ['path', 'Path'],
  ['exif_info', 'EXIF'],
  ['score', 'Score'],
  ['search_info', 'Search info'],
  ['cloud_guid', 'Cloud GUID'],
  ['uuid', 'UUID']
];

function renderMetadataTable(data: Record<string, unknown>): string {
  let html = '<table>';
  for (const [key, label] of METADATA_FIELDS) {
    if (!(key in data)) continue;
    const val = data[key];
    if (
      val === null ||
      val === undefined ||
      val === '' ||
      val === false ||
      (Array.isArray(val) && val.length === 0)
    ) {
      continue;
    }
    if (key === 'uuid') {
      html += `<tr><td>${label}</td><td>${formatMetadataValue(val)} <button class="copy-btn" onclick="navigator.clipboard.writeText('${String(val)}').then(()=>{this.classList.add('copied');setTimeout(()=>this.classList.remove('copied'),1000)})" title="Copy UUID"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25z"/></svg></button></td></tr>`;
    } else {
      html += `<tr><td>${label}</td><td>${formatMetadataValue(val)}</td></tr>`;
    }
  }
  html += '</table>';
  return html;
}

function showMetadata(uuid: string) {
  const modal = document.getElementById('metadata-modal');
  const body = document.getElementById('metadata-body');
  if (modal === null || body === null) return;

  body.innerHTML = '<div class="loading">Loading...</div>';
  modal.classList.add('active');

  void fetch(`/api/metadata/${uuid}`)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<Record<string, unknown>>;
    })
    .then((data) => {
      body.innerHTML = renderMetadataTable(data);
    })
    .catch((err: unknown) => {
      body.innerHTML = `<div class="loading">Failed to load metadata: ${err instanceof Error ? err.message : String(err)}</div>`;
    });
}

function initMetadataModal() {
  const modal = document.getElementById('metadata-modal');
  const closeBtn = document.getElementById('metadata-close');

  closeBtn?.addEventListener('click', () => {
    modal?.classList.remove('active');
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
  // Capture phase — intercept all keys when metadata modal is open
  document.addEventListener(
    'keydown',
    (e) => {
      if (modal?.classList.contains('active') !== true) return;
      // Only allow Escape through (to close), block everything else
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        modal.classList.remove('active');
        return;
      }
      // Stop arrow keys etc. from reaching lightbox/popup handlers
      e.stopImmediatePropagation();
    },
    true
  );
}

function cascadeAndApply() {
  const y =
    (document.getElementById('year-select') as HTMLSelectElement | null)
      ?.value ?? 'all';

  // Cascade: Year → Album options
  const yearPhotos =
    y === 'all' ? state.photos : state.photos.filter((p) => getYear(p) === y);
  repopulateSelect(
    'album-select',
    [...new Set(yearPhotos.flatMap((p) => p.albums))].sort()
  );
  const a =
    (document.getElementById('album-select') as HTMLSelectElement | null)
      ?.value ?? 'all';

  // Cascade: Year + Album → Camera options
  const albumPhotos =
    a === 'all' ? yearPhotos : yearPhotos.filter((p) => p.albums.includes(a));
  repopulateSelect(
    'camera-select',
    [...new Set(albumPhotos.map((p) => p.camera ?? '(unknown)'))].sort()
  );
  const c =
    (document.getElementById('camera-select') as HTMLSelectElement | null)
      ?.value ?? 'all';

  const m = Array.from(
    document.querySelectorAll('#media-buttons .filter-btn.active')
  ).map((btn) => (btn as HTMLElement).dataset.value!);
  const g = Array.from(
    document.querySelectorAll('#gps-buttons .filter-btn.active')
  ).map((btn) => (btn as HTMLElement).dataset.value!);
  applyFilters({ year: y, gps: g, media: m, album: a, camera: c });
}

function setupFilterListeners() {
  const yearSelect = document.getElementById('year-select');
  const albumSelect = document.getElementById('album-select');
  const cameraSelect = document.getElementById('camera-select');
  const mediaButtons = document.getElementById('media-buttons');
  const gpsButtons = document.getElementById('gps-buttons');

  for (const el of [yearSelect, albumSelect, cameraSelect]) {
    el?.addEventListener('change', cascadeAndApply);
  }

  for (const container of [mediaButtons, gpsButtons]) {
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    container?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.filter-btn');
      if (btn === null) return;
      if (clickTimer !== null) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        btn.classList.toggle('active');
        cascadeAndApply();
      }, 250);
    });
    container?.addEventListener('dblclick', (e) => {
      if (clickTimer !== null) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.filter-btn');
      if (btn === null) return;
      for (const b of Array.from(container.querySelectorAll('.filter-btn'))) {
        b.classList.toggle('active', b === btn);
      }
      cascadeAndApply();
    });
  }
}

function reopenPopup(uuid: string | null) {
  if (uuid === null) return;
  const newIndex = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
  if (newIndex === -1) return;
  const photo = state.filteredPhotos[newIndex]!;
  showPopup({ index: newIndex }, [photo.lon ?? 0, photo.lat ?? 0]);
}

async function saveEdits() {
  const btn = document.getElementById('save-edits-btn');
  if (btn === null) return;
  const edits = getPendingEdits();
  const timeEdits = getPendingTimeEdits();
  if (edits.length === 0 && timeEdits.length === 0) return;

  btn.setAttribute('disabled', '');
  btn.textContent = 'Saving...';

  try {
    const response = await fetch('/api/set-locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edits, timeEdits })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    const reopenUuid = getCurrentPhotoUuid();
    getCurrentPopup()?.remove();
    await loadPhotos();
    clearPendingEdits();
    reopenPopup(reopenUuid);
  } catch (err) {
    console.error('Failed to save edits:', err);
    // eslint-disable-next-line no-alert -- user needs feedback on save failure
    alert(
      `Failed to save edits: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    btn.removeAttribute('disabled');
    btn.textContent = 'Save to Photos';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    initUI();
    initMetadataModal();

    // Event Listeners
    const mapButtons = document.getElementById('map-type-buttons');
    if (mapButtons !== null) {
      mapButtons.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>(
          '.map-type-btn'
        );
        if (btn === null) return;
        const style = btn.dataset.style;
        if (style === undefined) return;
        mapButtons
          .querySelector('.map-type-btn.active')
          ?.classList.remove('active');
        btn.classList.add('active');
        changeMapStyle(style);
      });
    }

    setupFilterListeners();

    // Fit to view button
    const fitViewBtn = document.getElementById('fit-view-btn');
    if (fitViewBtn !== null) {
      fitViewBtn.addEventListener('click', () => {
        fitToPhotos(true, true);
      });
    }

    // Save/Discard edits
    const saveBtn = document.getElementById('save-edits-btn');
    const discardBtn = document.getElementById('discard-edits-btn');

    if (saveBtn !== null) {
      saveBtn.addEventListener('click', () => {
        void saveEdits();
      });
    }

    if (discardBtn !== null) {
      discardBtn.addEventListener('click', () => {
        clearPendingEdits();
      });
    }

    // Load data
    await loadPhotos();

    // Init Map
    initMap();

    // Populate UI — year is static, album/camera cascade from year
    const years = [
      ...new Set(
        state.photos.map(getYear).filter((y): y is string => y !== null)
      )
    ].sort();
    repopulateSelect('year-select', years);
    cascadeAndApply();

    updateStats(state.filteredPhotos);
  })();
});

subscribe((filtered) => {
  updateStats(filtered);
});

subscribeEdits((count) => {
  updatePendingEdits(count);
});
