import { expect, test } from "@playwright/test";
for (const width of [1280, 390]) {
  test(`related article and author work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/blog/exglass-software/");
    const section = page.getByRole("region", { name: "Related articles" });
    await expect(section.getByRole("link")).toHaveCount(1);
    await expect(section.getByRole("link")).toHaveText(
      "Velsat: Building the Software Behind a CanSat",
    );
    expect(
      await section.evaluate((element) => {
        const author = document.querySelector(".author-bio");
        return (
          !!author &&
          !!(
            author.compareDocumentPosition(element) &
            Node.DOCUMENT_POSITION_FOLLOWING
          )
        );
      }),
    ).toBe(true);
    await expect(page.locator(".author-bio")).toContainText("Andrei Turcan");
    await section.getByRole("link").click();
    await expect(page).toHaveURL(/velsat-software/);
    await expect(
      page.getByRole("region", { name: "Related articles" }).getByRole("link"),
    ).toHaveText("ExGlass: What I Learned Building a Vision Prototype");
  });
}
