import { expect, test } from '@playwright/test';

test('clicking the filter-panel header collapses and re-expands the body', async ({
  page
}) => {
  await page.goto('/');

  const header = page.locator('filter-panel >> .panel-header');
  const yearLabel = page
    .locator('filter-panel >> .panel-body label')
    .filter({ hasText: 'Year' });

  await expect(header).toBeVisible();
  await expect(yearLabel).toBeVisible();

  await header.click();
  await expect(yearLabel).toHaveCount(0);

  await header.click();
  await expect(yearLabel).toBeVisible();
});
