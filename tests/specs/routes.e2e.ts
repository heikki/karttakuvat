import { expect, test } from '@playwright/test';

import { layerVisibility, sourceFeatureCount } from './_helpers';

// Route polyline lives in the `photo-route` MapLibre source, rendered by the
// `photo-route-line` layer. Clicking the Route button on `<album-controls>`
// toggles `viewState.routeVisible`: on-flip it populates the source from
// filtered photos; off-flip it flips the layer's visibility property to
// "none" (the source is left intact for snappy re-show).

test('Toggle photo route on the map', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('filter-panel >> .panel-header p')).toHaveText(
    '3 photos'
  );
  await expect(page.locator('map-fit')).toBeAttached();

  // Filter to Tampere → enables the Route button.
  await page
    .locator('filter-panel >> .panel-body select')
    .nth(1)
    .selectOption('Tampere');

  const routeBtn = page
    .locator('filter-panel >> button.view-btn')
    .filter({ hasText: 'Route' });
  await expect(routeBtn).toBeEnabled();
  await expect(routeBtn).not.toHaveClass(/active/);

  // No route yet → source is empty and layer is hidden.
  expect(await sourceFeatureCount(page, 'photo-route')).toBe(0);
  expect(await layerVisibility(page, 'photo-route-line')).toBe('none');

  // Click Route → source picks up features built from the filtered photos
  // (Tampere has e2e-2 and e2e-3, so buildDefault wires a 2-photo route),
  // and the line layer becomes visible.
  await routeBtn.click();
  await expect(routeBtn).toHaveClass(/active/);
  await expect
    .poll(() => sourceFeatureCount(page, 'photo-route'))
    .toBeGreaterThan(0);
  await expect
    .poll(() => layerVisibility(page, 'photo-route-line'))
    .toBe('visible');

  // Click Route again → layer hides; the user no longer sees the polyline.
  await routeBtn.click();
  await expect(routeBtn).not.toHaveClass(/active/);
  await expect
    .poll(() => layerVisibility(page, 'photo-route-line'))
    .toBe('none');
});
