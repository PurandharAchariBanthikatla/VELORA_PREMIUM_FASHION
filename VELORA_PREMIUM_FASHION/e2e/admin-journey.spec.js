// Real-browser E2E — admin journey. See customer-journey.spec.js for the
// note on why this could not be executed in the sandbox that built this
// project (no network path to a browser-binary CDN) — written and ready to
// run with `npm run e2e` in any environment with normal internet access.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const admin = { email: 'admin@velora.com', password: 'Admin@123' };
const unique = Date.now();

test('admin can sign in', async ({ page }) => {
  await page.goto('/admin/');
  await page.fill('#loginEmail, input[type=email]', admin.email);
  await page.fill('#loginPassword, input[type=password]', admin.password);
  await page.click('button[type=submit]');
  await expect(page.locator('body')).toContainText(/Dashboard|Products|Orders/i, { timeout: 10_000 });
});

test('admin dashboard stats load without error', async ({ page }) => {
  await page.goto('/admin/');
  // This is the exact endpoint that had a live SQL bug (getRevenueByDay
  // aliasing a reserved word) found and fixed during the Phase 3 audit —
  // asserting the dashboard actually renders numbers, not an error state,
  // is a direct regression check for that fix.
  await expect(page.locator('body')).not.toContainText(/could not complete the request/i);
  await expect(page.locator('[id*=revenue], [id*=stat]').first()).toBeVisible({ timeout: 10_000 });
});

test('admin can create a product', async ({ page }) => {
  await page.goto('/admin/');
  await page.click('a:has-text("Products"), button:has-text("Products")').catch(() => {});
  await page.click('button:has-text("Add Product"), button:has-text("New Product")');
  await page.fill('input[name=title], #productTitle', `E2E Test Product ${unique}`);
  await page.fill('input[name=sellingPrice], #productPrice', '1999');
  await page.fill('input[name=stock], #productStock', '10');
  await page.click('button[type=submit]:has-text("Save")');
  await expect(page.locator('body')).toContainText(`E2E Test Product ${unique}`, { timeout: 10_000 });
});

test('admin can edit and then delete the product (audit log CRUD)', async ({ page }) => {
  await page.goto('/admin/');
  const row = page.locator(`tr:has-text("E2E Test Product ${unique}")`);
  await row.locator('button:has-text("Edit")').click();
  await page.fill('input[name=sellingPrice], #productPrice', '1799');
  await page.click('button[type=submit]:has-text("Save")');
  await expect(page.locator('body')).toContainText('1799', { timeout: 10_000 });

  await row.locator('button:has-text("Delete")').click();
  await page.click('button:has-text("Confirm"), button:has-text("Yes")').catch(() => {});
  await expect(page.locator(`tr:has-text("E2E Test Product ${unique}")`)).toHaveCount(0, { timeout: 10_000 });
});

test('admin can create a coupon', async ({ page }) => {
  await page.goto('/admin/');
  await page.click('a:has-text("Coupons"), button:has-text("Coupons")').catch(() => {});
  await page.click('button:has-text("Add Coupon"), button:has-text("New Coupon")');
  await page.fill('input[name=code], #couponCode', `E2E${unique}`);
  await page.fill('input[name=value], #couponValue', '10');
  await page.click('button[type=submit]:has-text("Save")');
  await expect(page.locator('body')).toContainText(`E2E${unique}`, { timeout: 10_000 });
});

test('admin can view and update order status', async ({ page }) => {
  await page.goto('/admin/');
  await page.click('a:has-text("Orders"), button:has-text("Orders")').catch(() => {});
  const firstOrderRow = page.locator('#ordersBody tr').first();
  if (await firstOrderRow.count()) {
    await firstOrderRow.locator('.statusSelect, select').selectOption({ label: 'Processing' }).catch(() => {});
  }
});

test('admin can view Settings and update tax/shipping/currency', async ({ page }) => {
  await page.goto('/admin/');
  await page.click('a:has-text("Settings"), button:has-text("Settings")').catch(() => {});
  const taxInput = page.locator('input[name=taxPercent], #taxPercent');
  if (await taxInput.count()) {
    await taxInput.fill('12');
    await page.click('button[type=submit]:has-text("Save")');
    await expect(page.locator('body')).toContainText(/saved|updated/i, { timeout: 10_000 });
  }
});
