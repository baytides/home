import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('should have correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Bay Tides/);
  });

  test('should display header navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeAttached();
  });

  test('should have skip link for accessibility', async ({ page }) => {
    await page.goto('/');
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeAttached();
  });

  test('should toggle theme when theme button clicked', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#theme-toggle');

    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );

    await page.click('#theme-toggle');

    const newTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));

    expect(newTheme).not.toBe(initialTheme);
  });
});

test.describe('Navigation', () => {
  async function openNavIfCollapsed(page) {
    const mobileMenuToggle = page.locator('.mobile-menu-toggle');
    if (await mobileMenuToggle.isVisible()) {
      await mobileMenuToggle.click();
    }
  }

  test('should navigate to about page', async ({ page }) => {
    await page.goto('/');
    await openNavIfCollapsed(page);
    await page.click('nav a[href="/about"]');
    await expect(page).toHaveURL(/\/about/);
    await expect(page).toHaveTitle(/About/);
  });

  test('should navigate to contact page', async ({ page }) => {
    await page.goto('/');
    await openNavIfCollapsed(page);
    await page.click('nav a[href="/contact"]');
    await expect(page).toHaveURL(/\/contact/);
    await expect(page).toHaveTitle(/Contact/);
  });
});

test.describe('Accessibility', () => {
  test('should have proper heading hierarchy', async ({ page }) => {
    await page.goto('/');
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1);
  });

  test('should have alt text on images', async ({ page }) => {
    await page.goto('/');
    const imagesWithoutAlt = await page.locator('img:not([alt])').count();
    expect(imagesWithoutAlt).toBe(0);
  });

  test('should have accessible focus indicators', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });

  test('accessibility panel should open and close', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.accessibility-toggle');

    await page.click('.accessibility-toggle');
    await expect(page.locator('.accessibility-panel.visible')).toBeVisible();

    // Click outside to close
    await page.click('body', { position: { x: 10, y: 10 } });
    await expect(page.locator('.accessibility-panel.visible')).not.toBeVisible();
  });
});

test.describe('Search', () => {
  test('should open search with keyboard shortcut', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.locator('#search-overlay.active')).toBeVisible();
  });

  test('should close search with Escape', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#search-toggle');

    await page.click('#search-toggle');
    await expect(page.locator('#search-overlay.active')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#search-overlay.active')).not.toBeVisible();
  });
});

test.describe('Contact Form', () => {
  test('should show validation errors for empty form', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForSelector('#contact-form');

    await page.click('#contact-form button[type="submit"]');

    const invalidInputs = await page.locator('#contact-form :invalid').count();
    expect(invalidInputs).toBeGreaterThan(0);
  });

  test('should validate email format', async ({ page }) => {
    await page.goto('/contact');
    await page.waitForSelector('#contact-form');

    const emailInput = page.locator('#contact-form input[name="email"]');
    await emailInput.fill('invalid-email');
    await emailInput.blur();
    await expect(emailInput).toHaveJSProperty('validity.valid', false);
  });
});

test.describe('Mobile Responsiveness', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('should show mobile menu toggle on small screens', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.mobile-menu-toggle');
    await expect(page.locator('.mobile-menu-toggle')).toBeVisible();
  });

  test('should toggle mobile menu', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.mobile-menu-toggle');

    await page.click('.mobile-menu-toggle');
    await expect(page.locator('nav ul.active')).toBeVisible();
  });
});
