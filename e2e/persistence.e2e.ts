import { expect, test } from '@playwright/test';

test('year filter survives a page reload via URL', async ({ page }) => {
  await page.goto('/');

  const selects = page.locator('filter-panel >> .panel-body select');
  await expect(selects).toHaveCount(3);
  const yearSelect = selects.nth(0);

  await yearSelect.selectOption('2024');
  // 100ms debounce in updateUrl before history.replaceState fires.
  await expect(page).toHaveURL(/year=2024/);

  await page.reload();
  await expect(
    page.locator('filter-panel >> .panel-body select').nth(0)
  ).toHaveValue('2024');
});

test('album filter survives a page reload via URL', async ({ page }) => {
  await page.goto('/');

  const selects = page.locator('filter-panel >> .panel-body select');
  await expect(selects).toHaveCount(3);
  const albumSelect = selects.nth(1);

  await albumSelect.selectOption('Tampere');
  await expect(page).toHaveURL(/album=Tampere/);

  await page.reload();
  await expect(
    page.locator('filter-panel >> .panel-body select').nth(1)
  ).toHaveValue('Tampere');
});

test('combined year + album persist together', async ({ page }) => {
  await page.goto('/');

  const selects = page.locator('filter-panel >> .panel-body select');
  await expect(selects).toHaveCount(3);

  await selects.nth(0).selectOption('2024');
  await selects.nth(1).selectOption('Tampere');
  await expect(page).toHaveURL(/year=2024/);
  await expect(page).toHaveURL(/album=Tampere/);

  await page.reload();
  const after = page.locator('filter-panel >> .panel-body select');
  await expect(after.nth(0)).toHaveValue('2024');
  await expect(after.nth(1)).toHaveValue('Tampere');
});
