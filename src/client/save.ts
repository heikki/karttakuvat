import * as data from '@common/data';
import * as edits from '@common/edits';

export async function saveEdits(): Promise<void> {
  const coordEdits = edits.getCoordEdits();
  const timeEdits = edits.getTimeEdits();
  if (coordEdits.length === 0 && timeEdits.length === 0) return;

  edits.saving.set(true);

  try {
    const response = await fetch('/api/save-edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edits: coordEdits, timeEdits })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }
    await data.loadPhotos();
    edits.clear();
  } catch (err) {
    console.error('Failed to save edits:', err);
    // eslint-disable-next-line no-alert -- user needs feedback on save failure
    alert(
      `Failed to save edits: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    edits.saving.set(false);
  }
}
