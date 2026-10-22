import { expect, test } from "@playwright/test";

const endpoint = /\/api\/news(?:\?.*)?$/;
const initial = {
  items: Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    title: `Original headline ${i}`,
    url: `https://example.com/${i}`,
    sourceId: i % 2 ? "the-verge" : "techcrunch",
    sourceName: i % 2 ? "The Verge" : "TechCrunch",
    publishedAt: null,
  })),
  sources: ["techcrunch", "the-verge"].map((id) => ({
    id,
    name: id === "techcrunch" ? "TechCrunch" : "The Verge",
    status: "ok",
    lastSuccessfulFetch: "2026-10-22T08:00:00Z",
  })),
  checkedAt: "2026-10-22T08:00:00Z",
};
const updated = {
  ...initial,
  items: initial.items.map((item) => ({
    ...item,
    title: item.title.replace("Original", "Updated"),
  })),
  checkedAt: "2026-10-22T08:01:00Z",
  sources: initial.sources.map((source) => ({
    ...source,
    lastSuccessfulFetch: "2026-10-22T08:01:00Z",
  })),
};

for (const { path, width, count } of [
  { path: "/news/", width: 1280, count: 8 },
  { path: "/news/", width: 390, count: 8 },
  { path: "/", width: 390, count: 6 },
]) {
  test(`refresh responds immediately and fades headlines on ${path} at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(endpoint, async (route) => {
      calls++;
      if (calls === 1)
        return route.fulfill({
          headers: { "access-control-allow-origin": "*" },
          json: initial,
        });
      expect(new URL(route.request().url()).searchParams.get("refresh")).toBe(
        "1",
      );
      await pending;
      return route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: updated,
      });
    });
    await page.goto(path);
    const list = page.locator("[data-news-list]");
    const button = page.locator("[data-news-retry]");
    await expect(list.locator("li")).toHaveCount(count);
    await expect(button).toBeEnabled();
    await page.evaluate(() => {
      const list = document.querySelector<HTMLElement>("[data-news-list]")!;
      const animate = list.animate.bind(list);
      // Inspect real browser effects at controlled times. A short offscreen
      // fade can finish between rendered frames on a busy WebKit CI runner.
      list.animate = (...args) => {
        const animation = animate(...args);
        animation.pause();
        animation.currentTime = 0;
        return animation;
      };
    });
    await button.click();
    await expect(button).toHaveText("Refreshing…");
    await expect(button).toBeDisabled();
    await expect(list).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status")).toContainText(
      "Checking the publishers",
    );
    await expect(list.locator("li")).toHaveCount(count);
    await expect(list).toHaveCSS("opacity", "1");
    // Even synthetic repeat clicks cannot start another request.
    await button.dispatchEvent("click");
    await button.dispatchEvent("click");
    expect(calls).toBe(2);
    if (path === "/news/") {
      await page
        .getByLabel("Publisher", { exact: true })
        .selectOption("the-verge");
      await expect(list.locator("li")).toHaveCount(4);
      await expect(page.getByRole("status")).toContainText(
        "Checking the publishers",
      );
    }
    release();
    for (const [headline, from, to] of [
      ["Original headline", 1, 0],
      ["Updated headline", 0, 1],
    ] as const) {
      await expect(list.locator("a").first()).toContainText(headline);
      await expect
        .poll(() =>
          list.evaluate(
            (element) =>
              element
                .getAnimations()
                .filter((animation) => animation.playState === "paused").length,
          ),
        )
        .toBe(1);
      await expect(button).toBeDisabled();
      await expect(list).toHaveAttribute("aria-busy", "true");
      const fade = await list.evaluate((element) => {
        const animation = element.getAnimations()[0];
        const effect = animation.effect as KeyframeEffect;
        const duration = Number(effect.getTiming().duration);
        animation.currentTime = duration / 2;
        return {
          keyframes: effect
            .getKeyframes()
            .map((frame) => Number(frame.opacity)),
          opacity: Number(getComputedStyle(element).opacity),
          duration,
        };
      });
      expect(fade.keyframes).toEqual([from, to]);
      expect(fade.duration).toBeGreaterThan(0);
      expect(fade.duration).toBeLessThanOrEqual(400);
      expect(fade.opacity).toBeCloseTo(0.5, 1);
      await list.evaluate((element) => element.getAnimations()[0].finish());
    }
    await expect(button).toBeEnabled();
    await expect(button).toHaveText("Refresh news");
    await expect(list).toHaveAttribute("aria-busy", "false");
    await expect(list).toHaveCSS("opacity", "1");
    await expect(page.getByRole("status")).toContainText("News refreshed");
    if (path === "/news/") {
      await expect(page.getByLabel("Publisher", { exact: true })).toHaveValue(
        "the-verge",
      );
      await expect(list.locator("li")).toHaveCount(4);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("unchanged and cooldown results give honest completion feedback", async ({
  page,
}) => {
  let calls = 0;
  await page.route(endpoint, (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: ++calls > 2 ? { ...initial, refreshDeferred: true } : initial,
    }),
  );
  await page.goto("/news/");
  const button = page.locator("[data-news-retry]");
  await expect(button).toBeEnabled();
  const checkTime = await page.locator("[data-news-checked]").textContent();
  await button.click();
  await expect(page.getByRole("status")).toContainText("You’re up to date");
  await button.click();
  await expect(page.getByRole("status")).toContainText(
    "Checked recently. Showing cached headlines",
  );
  await expect(page.getByRole("status")).not.toContainText("You’re up to date");
  await expect(page.locator("[data-news-checked]")).toHaveText(checkTime!);
  await expect(page.locator("[data-news-list] li")).toHaveCount(8);
});

for (const failure of ["network", "unavailable", "malformed", "timeout"]) {
  test(`keeps readable headlines after ${failure} and allows retry`, async ({
    page,
  }) => {
    let calls = 0;
    await page.route(endpoint, (route) => {
      calls++;
      if (calls !== 2)
        return route.fulfill({
          headers: { "access-control-allow-origin": "*" },
          json: initial,
        });
      if (failure === "network") return route.abort();
      if (failure === "timeout") return; // Held open until the client's 12-second timeout.
      return route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        status: failure === "unavailable" ? 503 : 200,
        json:
          failure === "unavailable"
            ? {
                ...initial,
                items: [],
                sources: initial.sources.map((s) => ({
                  ...s,
                  status: "unavailable",
                })),
              }
            : { ...initial, items: [null] },
      });
    });
    await page.goto("/news/");
    const button = page.locator("[data-news-retry]");
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByRole("status")).toContainText(
      "Previously loaded headlines remain",
      { timeout: 15_000 },
    );
    await expect(page.locator("[data-news-list] li")).toHaveCount(8);
    await expect(page.locator("[data-news-list]")).toHaveCSS("opacity", "1");
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByRole("status")).toContainText("You’re up to date");
    await expect(button).toBeEnabled();
  });
}

test("reduced motion skips fades and spinner motion but retains live feedback", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(endpoint, async (route) => {
    if (++calls === 1)
      return route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: initial,
      });
    await pending;
    return route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: updated,
    });
  });
  await page.goto("/news/");
  const button = page.locator("[data-news-retry]");
  await expect(button).toBeEnabled();
  await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>("[data-news-list]")!;
    const animate = list.animate.bind(list);
    Reflect.set(window, "newsAnimations", 0);
    list.animate = (...args) => {
      Reflect.set(
        window,
        "newsAnimations",
        Reflect.get(window, "newsAnimations") + 1,
      );
      return animate(...args);
    };
  });
  await button.click();
  await expect(page.getByRole("status")).toContainText("Refreshing news");
  await expect(page.locator(".news-refresh-icon")).toHaveCSS(
    "animation-name",
    "none",
  );
  release();
  await expect(page.locator("[data-news-list] a").first()).toContainText(
    "Updated",
  );
  await expect(button).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(window, "newsAnimations"))).toBe(
    0,
  );
});

test("a late response after navigation cannot update the next feed", async ({
  page,
}) => {
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(endpoint, async (route) => {
    if (++calls === 2) {
      await pending;
      await route
        .fulfill({
          headers: { "access-control-allow-origin": "*" },
          json: updated,
        })
        .catch(() => {});
    } else
      await route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: initial,
      });
  });
  await page.goto("/news/");
  const button = page.locator("[data-news-retry]");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeDisabled();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(page.locator("[data-news-list] li")).toHaveCount(6);
  release();
  await expect(page.locator("[data-news-list] a").first()).toContainText(
    "Original",
  );
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole("status")).toContainText("You’re up to date");
  expect(calls).toBe(4);
});

test("partial refresh reports stale publishers instead of claiming it is up to date", async ({
  page,
}) => {
  let calls = 0;
  await page.route(endpoint, (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json:
        ++calls === 1
          ? initial
          : {
              ...updated,
              sources: updated.sources.map((s, i) =>
                i
                  ? {
                      ...s,
                      status: "stale",
                      lastSuccessfulFetch: initial.checkedAt,
                    }
                  : s,
              ),
            },
    }),
  );
  await page.goto("/news/");
  await expect(page.locator("[data-news-retry]")).toBeEnabled();
  await page.getByRole("button", { name: "Refresh news" }).click();
  await expect(page.getByRole("status")).toContainText(
    "The Verge (cached headlines)",
  );
  await expect(page.getByRole("status")).not.toContainText("You’re up to date");
  await expect(page.locator("[data-news-sources]")).toContainText(
    "cached headlines",
  );
});
