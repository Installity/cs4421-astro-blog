import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/news(?:\?.*)?$/, (route) => route.fulfill({
    json: {
      items: [{ id: "1", title: "Navigation test headline", url: "https://example.com/story", sourceId: "techcrunch", sourceName: "TechCrunch", publishedAt: null }],
      sources: [{ id: "techcrunch", name: "TechCrunch", status: "ok", lastSuccessfulFetch: null }],
      checkedAt: "2026-10-12T12:00:00Z",
    },
  }));
});

test("section navigation preserves the document and canvas, updates metadata and supports history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("canvas")).toHaveAttribute("data-ready", "true");
  const canvas = await page.locator("canvas").elementHandle();
  await page.evaluate(() => Reflect.set(window, "navigationMarker", "same-document"));
  for (const [name, path, title] of [
    ["Blog", "/blog/", "Blog"],
    ["Tech News", "/news/", "Tech News"],
    ["About", "/about/", "About"],
    ["Home", "/", "Andrei Turcan"],
  ]) {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page).toHaveTitle(new RegExp(title));
    await expect(page.locator('nav [aria-current="page"]')).toHaveText(name);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${path}$`));
    expect(await page.evaluate(() => Reflect.get(window, "navigationMarker"))).toBe("same-document");
    expect(await canvas!.evaluate((node) => node === document.querySelector("canvas"))).toBe(true);
  }
  await page.goBack();
  await expect(page.locator('nav [aria-current="page"]')).toHaveText("About");
  await page.goForward();
  await expect(page.locator('nav [aria-current="page"]')).toHaveText("Home");
  expect(errors).toEqual([]);
});

test("theme and pause controls remain usable through repeat visits and article navigation", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/about/");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
  await page.getByRole("button", { name: "Pause background" }).click();
  for (let visit = 0; visit < 2; visit++) {
    await page.getByRole("navigation").getByRole("link", { name: "Blog", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search posts" });
    await search.fill("telemetry");
    await search.press("Enter");
    await expect(page.locator("[data-post-list] > li:visible")).toHaveCount(1);
    await search.fill("");
    await search.press("Enter");
    await page.getByLabel("Filter by topic").selectOption({ label: "Telemetry" });
    await expect(page.locator("[data-post-list] > li:visible")).toHaveCount(1);
    await page.locator("[data-post-list] > li:visible .title a").click();
    await expect(page.locator("main h1")).toContainText("Velsat");
    await expect(page.locator('nav [aria-current="page"]')).toHaveText("Blog");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("canvas")).toHaveAttribute("data-motion", "paused");
    await page.getByRole("navigation").getByRole("link", { name: "About" }).click();
  }
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
  await page.getByRole("button", { name: "Resume background" }).click();
  await expect(page.locator("canvas")).toHaveAttribute("data-motion", "running");
});

test("news initializes on each return with one refresh handler", async ({ page }) => {
  let calls = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/news") calls++; });
  await page.goto("/about/");
  for (let visit = 0; visit < 2; visit++) {
    await page.getByRole("navigation").getByRole("link", { name: "Tech News" }).click();
    await expect(page.locator("[data-news-list] li")).toHaveCount(1);
    await page.getByLabel("Publisher", { exact: true }).selectOption("the-verge");
    await expect(page.locator("[data-news-list] li")).toHaveCount(0);
    const beforeRefresh = calls;
    await page.getByRole("button", { name: "Refresh news" }).click();
    await expect(page.getByRole("button", { name: "Refresh news" })).toBeEnabled();
    expect(calls).toBe(beforeRefresh + 1);
    await page.getByRole("navigation").getByRole("link", { name: "About" }).click();
  }
  expect(calls).toBe(4);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`navigation animation respects ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/about/");
    test.skip(!(await page.evaluate(() => typeof document.startViewTransition === "function")), "Native snapshot inspection requires View Transitions support");
    await page.evaluate(() => {
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (update) => {
        const transition = start(update);
        void transition.ready.then(() => {
          const style = getComputedStyle(document.documentElement, "::view-transition-new(page-content)");
          Reflect.set(window, "navigationAnimation", { name: style.animationName, duration: style.animationDuration });
        });
        return transition;
      };
    });
    await page.getByRole("navigation").getByRole("link", { name: "Blog", exact: true }).click();
    await expect(page.getByRole("searchbox")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "navigationAnimation"))).toEqual(
      reducedMotion === "reduce" ? { name: "none", duration: "0s" } : { name: "astroFadeIn", duration: "0.18s" },
    );
  });
}

test("fallback keeps animated navigation and controls working without the native API", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, "startViewTransition", { value: undefined }));
  await page.goto("/about/");
  const canvas = await page.locator("canvas").elementHandle();
  await page.getByRole("navigation").getByRole("link", { name: "Blog", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("searchbox")).toBeVisible();
  expect(await canvas!.evaluate((node) => node === document.querySelector("canvas"))).toBe(true);
  await page.getByRole("button", { name: /Switch to .* mode/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("navigation still works with JavaScript disabled", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(baseURL!);
  await page.getByRole("navigation").getByRole("link", { name: "Blog", exact: true }).click();
  await expect(page.locator("main h1")).toHaveText("From idea to implementation.");
  await page.getByRole("navigation").getByRole("link", { name: "About" }).click();
  await expect(page.locator('nav [aria-current="page"]')).toHaveText("About");
  await context.close();
});
