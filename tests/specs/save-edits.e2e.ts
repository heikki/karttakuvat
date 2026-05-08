import { expect, test } from '@playwright/test';

// `KARTTAKUVAT_NO_PHOTOS_WRITES=1` (set by playwright.config.ts) makes the
// default PhotosWriter throw, but `handleSaveEdits` still returns
// `{ ok: true }` because it logs per-edit failures and reports overall
// success. So the client-visible flow is: pending → Save → reload → pending
// section gone.

test('Save edits', async ({ page }) => {
  await page.goto('/?id=e2e-1');

  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();

  // Create a pending time edit (cheaper than placement: no canvas click).
  await popup
    .locator('.action-buttons')
    .first()
    .locator('button.action-btn')
    .filter({ hasText: 'edit' })
    .click();
  await popup.locator('button.action-btn').filter({ hasText: '+1h' }).click();

  const editSection = page.locator('filter-panel >> .edit-section');
  await expect(editSection).toBeVisible();
  await expect(editSection.locator('.count')).toHaveText('1');

  // Click Save → server returns { ok: true }, client clears edits.
  await editSection
    .locator('button')
    .filter({ hasText: /Save to Photos|Saving/ })
    .click();

  // Section disappears once edits.clear() runs after the successful POST.
  await expect(page.locator('filter-panel >> .edit-section')).toHaveCount(0);
});
