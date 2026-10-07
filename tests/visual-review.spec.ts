import { expect, test } from "@playwright/test";
for (const width of [1440, 390]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${width}px ${colorScheme} pages fit the viewport`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.route("**/api/news", (route) =>
        route.fulfill({
          json: {
            items: [
              {
                id: "one",
                title: "A look at the latest developments in technology",
                url: "https://example.com/story",
                sourceId: "techcrunch",
                sourceName: "TechCrunch",
                publishedAt: "2026-10-07T12:00:00Z",
              },
            ],
            sources: [
              {
                id: "techcrunch",
                name: "TechCrunch",
                status: "ok",
                lastSuccessfulFetch: "2026-10-07T12:00:00Z",
              },
            ],
            checkedAt: "2026-10-07T12:00:00Z",
          },
        }),
      );
      for (const [name, path] of [
        ["home", "/"],
        ["blog", "/blog/"],
        ["article", "/blog/exglass-software/"],
        ["news", "/news/"],
        ["about", "/about/"],
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (name === "home" || name === "news")
          await expect(page.locator("[data-news-list] li")).toHaveCount(1);
        // Opt-in review evidence; normal CI runs don't write into documentation.
        if (process.env.CAPTURE_REDESIGN === "1")
          await page.screenshot({
            path: `test-results/redesign-${name}-${width}-${colorScheme}-${test.info().project.name}.jpg`,
            fullPage: name === "home",
            type: "jpeg",
            quality: 80,
            style: "astro-dev-toolbar {display:none !important}",
          });
      }
    });
  }
}
