import { expect, test } from "@playwright/test";

for (const slug of ["velsat-software", "exglass-software"]) {
  test(`${slug} loads a bundled author portrait and uses the public site URL`, async ({ page }) => {
    const externalPortraits: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "media.licdn.com") externalPortraits.push(request.url());
    });
    await page.goto(`/blog/${slug}/`);
    const portrait = page.getByAltText("Portrait of Andrei Turcan");
    await portrait.scrollIntoViewIfNeeded();
    await expect.poll(() => portrait.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const source = new URL((await portrait.getAttribute("src"))!, page.url());
    expect(source.origin).toBe(new URL(page.url()).origin);
    expect(externalPortraits).toEqual([]);
    const site = process.env.PUBLIC_SITE_URL || "https://d2lpj15qx37gqq.cloudfront.net";
    const canonical = new URL(`/blog/${slug}/`, site).href;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
    await expect(page.locator('link[type="application/rss+xml"]')).toHaveAttribute("href", new URL("/rss.xml", site).href);
  });
}
