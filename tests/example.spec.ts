import { test, expect } from "@playwright/test";
test("personal articles are the only RSS entries", async ({ request }) => {
  const response = await request.get("/rss.xml");
  const xml = await response.text();
  expect(response.ok()).toBe(true);
  expect(xml.match(/<item>/g)).toHaveLength(2);
  expect(xml).toContain("/blog/velsat-software/");
  expect(xml).toContain("/blog/exglass-software/");
  expect(xml).not.toContain("using-mdx");
});
test("navigation reaches About and News", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "About", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Hi, I'm Andrei.",
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Tech News", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tech News");
});
