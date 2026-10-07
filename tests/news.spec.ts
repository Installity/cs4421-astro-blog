import { expect, test } from "@playwright/test";
const sources = [
  {
    id: "techcrunch",
    name: "TechCrunch",
    status: "ok",
    lastSuccessfulFetch: "2026-10-07T12:00:00Z",
  },
  {
    id: "the-verge",
    name: "The Verge",
    status: "ok",
    lastSuccessfulFetch: "2026-10-07T12:00:00Z",
  },
  {
    id: "techcentral",
    name: "TechCentral.ie",
    status: "unavailable",
    lastSuccessfulFetch: null,
  },
];
const items = Array.from({ length: 8 }, (_, i) => ({
  id: String(i),
  title: `Headline ${i}`,
  url: `https://example.com/${i}`,
  sourceId: i % 2 ? "the-verge" : "techcrunch",
  sourceName: i % 2 ? "The Verge" : "TechCrunch",
  publishedAt: "2026-10-07T12:00:00Z",
}));
const payload = { items, sources, checkedAt: "2026-10-07T12:00:00Z" };
test("news preview, publisher filters, availability and refresh work", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/news", (route) => {
    calls++;
    return route.fulfill({ json: payload });
  });
  await page.goto("/");
  await expect(page.locator("[data-news-list] li")).toHaveCount(6);
  await page.getByRole("link", { name: "All tech news ↗" }).click();
  await expect(page.locator("[data-news-list] li")).toHaveCount(8);
  await expect(page.locator("[data-news-status]")).toContainText(
    "TechCentral.ie (unavailable)",
  );
  await page.getByLabel("Publisher", { exact: true }).selectOption("the-verge");
  await expect(page.locator("[data-news-list] li")).toHaveCount(4);
  await expect(page.locator("[data-news-list] li").first()).toContainText(
    "The Verge",
  );
  await expect(page.locator("[data-news-list] a").first()).toHaveAttribute(
    "href",
    "https://example.com/1",
  );
  await expect(page.locator("[data-news-list] a").first()).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await page
    .getByLabel("Publisher", { exact: true })
    .selectOption("techcentral");
  await expect(page.locator("[data-news-status]")).toHaveText(
    "No headlines are available for this publisher.",
  );
  await page.getByRole("button", { name: "Refresh news" }).click();
  expect(calls).toBe(3);
});
test("handles outage and recovery, rendering feed strings as text", async ({
  page,
}) => {
  let recovered = false;
  await page.route("**/api/news", (route) =>
    route.fulfill({
      status: recovered ? 200 : 503,
      json: recovered
        ? {
            ...payload,
            items: [
              { ...items[0], title: "<img src=x onerror=alert(1)> headline" },
            ],
          }
        : { ...payload, items: [] },
    }),
  );
  await page.goto("/news/");
  await expect(page.locator("[data-news-status]")).toContainText(
    "temporarily unavailable",
  );
  recovered = true;
  await page.getByRole("button", { name: "Refresh news" }).click();
  await expect(page.locator("[data-news-list] a")).toHaveText(
    "<img src=x onerror=alert(1)> headline",
  );
  await expect(page.locator("[data-news-list] img")).toHaveCount(0);
});
test("keeps loaded headlines if a later refresh fails", async ({ page }) => {
  let failed = false;
  await page.route("**/api/news", (route) =>
    failed ? route.abort() : route.fulfill({ json: payload }),
  );
  await page.goto("/news/");
  await expect(page.locator("[data-news-list] li")).toHaveCount(8);
  failed = true;
  await page.getByRole("button", { name: "Refresh news" }).click();
  await expect(page.locator("[data-news-status]")).toContainText(
    "Previously loaded headlines remain",
  );
  await expect(page.locator("[data-news-list] li")).toHaveCount(8);
});
test("background respects reduced motion and keeps manual pause across pages", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Background motion reduced" }),
  ).toBeDisabled();
  await expect(page.locator("canvas")).toHaveAttribute("data-motion", "paused");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(
    page.getByRole("button", { name: "Pause background" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Pause background" }).click();
  await expect(page.locator("canvas")).toHaveAttribute("data-motion", "paused");
  await page.goto("/about/");
  await expect(
    page.getByRole("button", { name: "Resume background" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume background" }).click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-motion",
    "running",
  );
});
