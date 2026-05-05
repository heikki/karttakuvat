import { expect, test } from '@playwright/test';

// Fixture sorted by date (toUtcSortKey, tz +03:00):
//   e2e-2 — 2023:08:15 (oldest)
//   e2e-1 — 2024:06:01
//   e2e-3 — 2024:09:20 (newest)
//
// Marker click is fragile (MapLibre canvas + WebGL); we open the popup
// via URL instead, then drive everything else through real UI.

test('popup: keyboard navigation, placement, pending-edit count', async ({
  page
}) => {
  await page.goto('/?id=e2e-1');

  // Markers loaded — filter-panel stats line reflects fixture count.
  await expect(page.locator('filter-panel >> .panel-header p')).toHaveText(
    '3 photos'
  );

  // Popup mounts at the URL-selected photo.
  const popup = page.locator('photo-popup');
  await expect(popup).toBeVisible();

  // Right → next photo by date sort (e2e-3).
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/id=e2e-3/);

  // Left → back one (e2e-1).
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/id=e2e-1/);

  // Click the popup's "set" button → enters placement mode, popup unmounts.
  await popup.locator('button.action-btn').filter({ hasText: 'set' }).click();
  await expect(popup).toHaveCount(0);

  // Click anywhere on the map canvas → placement records the new coord
  // as a pending edit, exits placement mode, popup reopens.
  await page
    .locator('map-view >> canvas.maplibregl-canvas')
    .click({ position: { x: 250, y: 250 } });

  // Pending edit count surfaces in the filter panel.
  const editSection = page.locator('filter-panel >> .edit-section');
  await expect(editSection).toBeVisible();
  await expect(editSection.locator('.count')).toHaveText('1');
});
