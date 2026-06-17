import { test, expect } from '@playwright/test';

test('homepage renders and has expected title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/PhenoHandbook/);
});

test('patterns page loads and shows sidebar', async ({ page }) => {
  await page.goto('patterns/architecture/hexagonal');
  await expect(page.locator('aside').first()).toBeVisible();
});

test('hexagonal pattern page loads', async ({ page }) => {
  await page.goto('/patterns/architecture/hexagonal');
  await expect(page.locator('main h1').first()).toBeVisible();
});
