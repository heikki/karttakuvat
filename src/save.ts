import {
  clearPendingEdits,
  getPendingEdits,
  getPendingTimeEdits,
  loadPhotos,
  state
} from '@common/data';
import type { FilterPanel } from '@components/filter-panel';
import { getCurrentPhotoUuid, getCurrentPopup, showPopup } from './map/popup';

function getFilterPanel(): FilterPanel {
  return document.getElementById('filter-panel') as unknown as FilterPanel;
}

export function reopenPopup(uuid: string | null) {
  if (uuid === null) return;
  const newIndex = state.filteredPhotos.findIndex((p) => p.uuid === uuid);
  if (newIndex === -1) return;
  const photo = state.filteredPhotos[newIndex]!;
  showPopup({ index: newIndex }, [photo.lon ?? 0, photo.lat ?? 0]);
}

export async function saveEdits() {
  const panel = getFilterPanel();
  const edits = getPendingEdits();
  const timeEdits = getPendingTimeEdits();
  if (edits.length === 0 && timeEdits.length === 0) return;

  panel.saving = true;

  try {
    const response = await fetch('/api/save-edits', {
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
    panel.saving = false;
  }
}
