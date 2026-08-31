import { test, expect, type Page } from '@playwright/test';

/**
 * Hero background videos are decorative and expensive. BackgroundVideo.astro
 * only attaches the source when playing is appropriate, so the poster is all
 * most visitors download. These tests pin that behaviour -- it is the kind of
 * optimisation that silently regresses the moment someone adds `autoplay` back.
 */

/** Collect every .webm the page requests while `run` executes. */
async function recordVideoRequests(page: Page, run: () => Promise<void>): Promise<string[]> {
  const requested: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.endsWith('.webm')) requested.push(new URL(url).pathname);
  });
  await run();
  // Give the observer/playback a chance to fire before asserting absence.
  await page.waitForTimeout(2500);
  return requested;
}

test.describe('Hero background video loading', () => {
  test('desktop: hero video is fetched and plays', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const requests = await recordVideoRequests(page, async () => {
      await page.goto('/');
      await page.waitForSelector('video[data-bg-video]');
    });

    expect(requests).toContain('/assets/video/home-hero.webm');

    const started = await page.getAttribute('video[data-bg-video]', 'data-bg-video-started');
    expect(started).toBe('true');
  });

  test('mobile: hero video is never fetched, poster only', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const requests = await recordVideoRequests(page, async () => {
      await page.goto('/');
      await page.waitForSelector('video[data-bg-video]');
    });

    expect(requests).not.toContain('/assets/video/home-hero.webm');

    // The poster must still be present so the hero is not blank.
    const poster = await page.getAttribute('video[data-bg-video]', 'poster');
    expect(poster).toBe('/assets/video/home-hero-poster.webp');
  });

  test('reduced motion: hero video is never fetched', async ({ browser }) => {
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    const requests = await recordVideoRequests(page, async () => {
      await page.goto('/');
      // Existing CSS sets `display: none` on hero video under reduced motion,
      // so wait for it to be attached rather than visible.
      await page.waitForSelector('video[data-bg-video]', { state: 'attached' });
    });

    expect(requests).not.toContain('/assets/video/home-hero.webm');
    await context.close();
  });

  test('hero videos carry no autoplay attribute', async ({ page }) => {
    // autoplay overrides preload="none" and forces an immediate download,
    // which is the regression these tests exist to catch.
    for (const path of ['/', '/about', '/volunteer', '/donate']) {
      await page.goto(path);
      const autoplay = await page.locator('video[data-bg-video]').first().getAttribute('autoplay');
      expect(autoplay, `${path} hero must not autoplay`).toBeNull();
    }
  });
});
