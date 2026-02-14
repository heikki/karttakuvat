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

function uuidCellHtml(val: unknown): string {
  const uuid = typeof val === 'string' ? val : '';
  return `${formatMetadataValue(val)} <button class="copy-btn" onclick="navigator.clipboard.writeText('${uuid}').then(()=>{this.classList.add('copied');setTimeout(()=>this.classList.remove('copied'),1000)})" title="Copy UUID"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25z"/></svg></button>`;
}

function isEmptyValue(val: unknown): boolean {
  return (
    val === null ||
    val === undefined ||
    val === '' ||
    val === false ||
    (Array.isArray(val) && val.length === 0)
  );
}

function renderMetadataTable(data: Record<string, unknown>): string {
  let html = '<table>';
  for (const [key, label] of METADATA_FIELDS) {
    if (!(key in data)) continue;
    const val = data[key];
    if (isEmptyValue(val)) continue;
    const cell = key === 'uuid' ? uuidCellHtml(val) : formatMetadataValue(val);
    html += `<tr><td>${label}</td><td>${cell}</td></tr>`;
  }
  html += '</table>';
  return html;
}

export function showMetadata(uuid: string): void {
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

export function initMetadataModal(): void {
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
  document.addEventListener(
    'keydown',
    (e) => {
      if (modal?.classList.contains('active') !== true) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        modal.classList.remove('active');
        return;
      }
      e.stopImmediatePropagation();
    },
    true
  );
}
