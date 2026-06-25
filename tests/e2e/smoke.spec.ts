import { test, expect } from "@playwright/test";

test("homepage renders and has expected title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/PhenoHandbook/);
});

test("patterns page loads and shows sidebar", async ({ page }) => {
  await page.goto("patterns/architecture/hexagonal");
  await expect(page.locator("aside").first()).toBeVisible();
});

test("hexagonal pattern page loads", async ({ page }) => {
  // Use a path relative to the baseURL (no leading "/"). With
  // baseURL = "http://localhost:3000/handbook/" and a leading "/"
  // the URL would resolve to "http://localhost:3000/patterns/..."
  // (no /handbook/) and 404, because the leading slash makes it an
  // absolute path on the host. Keep this relative so the baseURL
  // prefix is preserved.
  await page.goto("patterns/architecture/hexagonal");
  await expect(page.locator("main h1").first()).toBeVisible();
});
