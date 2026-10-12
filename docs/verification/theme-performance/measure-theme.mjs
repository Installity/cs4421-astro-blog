import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
  });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`${process.env.TEST_BASE_URL ?? 'http://127.0.0.1:4321'}/about/`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('canvas[data-ready=true]');
  await page.evaluate(() => {
    window.themeSamples = { draws: 0, frames: [], collect: false };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (window.themeSamples.collect && this.canvas.matches('[data-wave-canvas]') &&
          document.documentElement.dataset.themeReveal === 'true') {
        window.themeSamples.draws++;
      }
      return clear.apply(this, args);
    };
    let last = 0;
    function frame(time) {
      if (window.themeSamples.collect && document.documentElement.dataset.themeReveal === 'true') {
        if (last) window.themeSamples.frames.push(time - last);
        last = time;
      } else last = 0;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  const samples = [];
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      window.themeSamples = { draws: 0, frames: [], collect: true };
    });
    const from = await page.locator('html').getAttribute('data-theme');
    await page.locator('[data-theme-toggle]').click();
    await page.waitForFunction(() => document.documentElement.dataset.themeReveal !== 'true');
    const data = await page.evaluate(() => {
      window.themeSamples.collect = false;
      return window.themeSamples;
    });
    const intervals = data.frames.toSorted((a, b) => a - b);
    samples.push({
      from, draws: data.draws, frames: intervals.length,
      medianMs: intervals[Math.floor(intervals.length / 2)],
      p95Ms: intervals[Math.floor(intervals.length * 0.95)],
      gapsOver25ms: intervals.filter(time => time > 25).length,
    });
    await page.waitForTimeout(200);
  }
  writeFileSync(process.argv[2] ?? 'docs/verification/theme-performance/after.json',
    JSON.stringify({ viewport: '1440x1000', cpuThrottle: 4, samples }, null, 2) + '\n');
} finally {
  await browser.close();
}
