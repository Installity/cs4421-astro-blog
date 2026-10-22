import { expect, test } from "@playwright/test";

const fixture = {
  items: [{ id: "one", title: "A headline after article navigation", url: "https://example.com/story", sourceId: "techcrunch", sourceName: "TechCrunch", publishedAt: null }],
  sources: [{ id: "techcrunch", name: "TechCrunch", status: "ok", lastSuccessfulFetch: null }],
  checkedAt: "2026-10-12T12:00:00Z",
};

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/news(?:\?.*)?$/, (route) => route.fulfill({
    json: fixture, headers: { "access-control-allow-origin": "*" },
  }));
});

test("first news visit after an article initializes once and cleans up on subsequent visits", async ({ page }) => {
  let requests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/news") requests++; });
  await page.goto("/about/");
  await page.getByRole("navigation").getByRole("link", { name: "Blog", exact: true }).click();
  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.getByRole("link", { name: "Velsat: Building the Software Behind a CanSat", exact: true }).click();
  await expect(page.locator("main h1")).toContainText("Velsat");
  await page.getByRole("navigation").getByRole("link", { name: "Tech News" }).click();
  await expect(page.locator("[data-news-list] li")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Refresh news" })).toBeEnabled();
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Refresh news" }).click();
  await expect(page.getByRole("button", { name: "Refresh news" })).toBeEnabled();
  expect(requests).toBe(2);
  await page.getByRole("navigation").getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.locator('nav [aria-current="page"]')).toHaveText("Home");
  await expect(page.locator("[data-news-list] li")).toHaveCount(1);
  expect(requests).toBe(3);
  await page.getByRole("navigation").getByRole("link", { name: "About" }).click();
  await expect(page.locator("main h1")).toContainText("Andrei");
  await page.getByRole("navigation").getByRole("link", { name: "Tech News" }).click();
  await expect(page.locator("[data-news-list] li")).toHaveCount(1);
  expect(requests).toBe(4);
});

test("news loads even if its first page-load event is missed without duplicate refresh handlers", async ({ page }) => {
  let requests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/news") requests++; });
  await page.addInitScript(() => {
    let suppress = true;
    document.addEventListener("astro:page-load", (event) => {
      if (suppress && location.pathname === "/news/") event.stopImmediatePropagation();
    }, { capture: true });
    Reflect.set(window, "releaseNewsPageLoad", () => {
      suppress = false;
      document.dispatchEvent(new Event("astro:page-load"));
      document.dispatchEvent(new Event("astro:page-load"));
    });
  });
  await page.goto("/about/");
  await page.getByRole("navigation").getByRole("link", { name: "Tech News" }).click();
  await expect(page.locator("[data-news-list] li")).toHaveCount(1);
  expect(requests).toBe(1);
  await page.evaluate(() => Reflect.get(window, "releaseNewsPageLoad")());
  await page.getByRole("button", { name: "Refresh news" }).click();
  await expect(page.getByRole("button", { name: "Refresh news" })).toBeEnabled();
  expect(requests).toBe(2);
});
