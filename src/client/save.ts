import {
  clearPendingEdits,
  getPendingEdits,
  getPendingTimeEdits,
  loadPhotos,
  setSaving
} from '@common/data';
import { SaveEditsEvent } from '@common/events';

async function saveEdits() {
  const edits = getPendingEdits();
  const timeEdits = getPendingTimeEdits();
  if (edits.length === 0 && timeEdits.length === 0) return;

  setSaving(true);

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
    await loadPhotos();
    clearPendingEdits();
  } catch (err) {
    console.error('Failed to save edits:', err);
    // eslint-disable-next-line no-alert -- user needs feedback on save failure
    alert(
      `Failed to save edits: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    setSaving(false);
  }
}

export function initSave() {
  document.addEventListener(SaveEditsEvent.type, () => {
    void saveEdits();
  });
}
