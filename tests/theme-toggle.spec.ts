import { expect, test } from "@playwright/test";

const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:4321";

test("switches blog colors and keeps the selected theme across pages", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${baseUrl}/blog/velsat-software/`);

  const toggle = page.getByRole("button", { name: "Switch to dark mode" });
  await expect(toggle).toBeVisible();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(244, 242, 238)",
  );
  await expect(page.locator(".prose")).toHaveCSS("color", "rgb(32, 32, 36)");

  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(9, 9, 11)",
  );
  await expect(page.locator(".prose")).toHaveCSS("color", "rgb(244, 241, 235)");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();

  await page.goto(`${baseUrl}/blog/`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(9, 9, 11)",
  );
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(244, 242, 238)",
  );
});

test("uses the system theme until the reader chooses a mode", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${baseUrl}/blog/velsat-software/`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Switch to dark mode" }),
  ).toBeVisible();
});
