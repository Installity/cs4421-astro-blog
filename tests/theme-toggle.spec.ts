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

test("moon control has an accessible name and supports the keyboard", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`${baseUrl}/about/`);
  const toggle = page.locator("[data-theme-toggle]");
  await expect(toggle).toHaveAttribute("aria-label", "Switch to dark mode");
  await expect(toggle.locator("svg")).toHaveCount(1);
  await expect(toggle).toHaveText("");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-label", "Switch to light mode");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
});

test("reveals the new theme from the button without a competing color fade", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto(`${baseUrl}/about/`);
  test.skip(!(await page.evaluate(() => typeof document.startViewTransition === "function")), "Browser uses the CSS color fallback");
  const toggle = page.locator("[data-theme-toggle]");
  const bounds = await toggle.boundingBox();
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (typeof options === "object" && options?.pseudoElement === "::view-transition-new(root)") {
        document.documentElement.dataset.revealFrames = JSON.stringify(keyframes);
        document.documentElement.dataset.revealDuration = String(options.duration);
        document.documentElement.dataset.snapshotColorDuration = getComputedStyle(document.body).transitionDuration;
      }
      return original.call(this, keyframes, options);
    };
  });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-reveal-duration", "600");
  await expect(page.locator("html")).toHaveAttribute("data-snapshot-color-duration", "0s");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement, "::view-transition-new(root)").clipPath)).toContain("circle(");
  const frames = JSON.parse(await page.locator("html").getAttribute("data-reveal-frames") ?? "{}");
  expect(frames.clipPath[0]).toBe(`circle(0px at ${bounds!.x + bounds!.width / 2}px ${bounds!.y + bounds!.height / 2}px)`);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
});

for (const theme of ["light", "dark"] as const) {
  test(`freezes the wave phase during a ${theme} theme reveal and resumes afterwards`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "no-preference" });
    await page.goto(`${baseUrl}/about/`);
    test.skip(!(await page.evaluate(() => typeof document.startViewTransition === "function")), "Browser uses the CSS color fallback");
    const canvas = page.locator("[data-wave-canvas]");
    await expect(canvas).toHaveAttribute("data-ready", "true");
    const originalPalette = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
    await page.evaluate(() => {
      const original = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        const animation = original.call(this, keyframes, options);
        if (typeof options === "object" && options?.pseudoElement === "::view-transition-new(root)") {
          animation.pause();
          (window as Window & { heldReveal?: Animation }).heldReveal = animation;
        }
        return animation;
      };
    });
    await page.locator("[data-theme-toggle]").click();
    await expect.poll(() => page.evaluate(() => (window as Window & { heldReveal?: Animation }).heldReveal?.playState)).toBe("paused");
    const frozen = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
    expect(frozen).not.toBe(originalPalette);
    const afterFrames = await canvas.evaluate(async (node) => {
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      return (node as HTMLCanvasElement).toDataURL();
    });
    expect(afterFrames).toBe(frozen);
    // Snapshot suspension must not masquerade as a reader's saved pause choice.
    await expect(page.getByRole("button", { name: "Pause background" })).toHaveAttribute("data-motion-state", "running");
    expect(await page.evaluate(() => localStorage.getItem("waves-paused"))).toBeNull();
    await page.evaluate(() => (window as Window & { heldReveal?: Animation }).heldReveal!.play());
    await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
    await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).not.toBe(frozen);
  });
}

test("reducing motion during a reveal cancels it and allows later background resumption", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto(`${baseUrl}/about/`);
  test.skip(!(await page.evaluate(() => typeof document.startViewTransition === "function")), "Browser uses the CSS color fallback");
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = original.call(this, keyframes, options);
      if (typeof options === "object" && options?.pseudoElement === "::view-transition-new(root)") animation.pause();
      return animation;
    };
  });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme-reveal", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
  await expect(page.getByRole("button", { name: "Background motion reduced" })).toBeDisabled();
  const canvas = page.locator("[data-wave-canvas]");
  await expect(canvas).toHaveAttribute("data-motion", "paused");
  expect(await page.evaluate(() => localStorage.getItem("waves-paused"))).toBeNull();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByRole("button", { name: "Pause background" })).toBeEnabled();
  const resumed = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).not.toBe(resumed);
});

test("theme reveals preserve a saved manual background pause", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.addInitScript(() => localStorage.setItem("waves-paused", "true"));
  await page.goto(`${baseUrl}/about/`);
  const canvas = page.locator("[data-wave-canvas]");
  await expect(page.getByRole("button", { name: "Resume background" })).toBeEnabled();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
  const paused = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const afterFrames = await canvas.evaluate(async (node) => {
    for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
    return (node as HTMLCanvasElement).toDataURL();
  });
  expect(afterFrames).toBe(paused);
  await expect(canvas).toHaveAttribute("data-motion", "paused");
  expect(await page.evaluate(() => localStorage.getItem("waves-paused"))).toBe("true");
});

test("rapid toggles finish on the latest request and leave the control usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto(`${baseUrl}/about/`);
  await page.locator("[data-wave-canvas]").waitFor();
  await expect(page.locator("[data-theme-toggle]")).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]")!;
    button.click();
    button.click();
    button.click();
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
  const canvas = page.locator("[data-wave-canvas]");
  const resumed = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).not.toBe(resumed);
  expect(errors).toEqual([]);
});

test("uses a smooth CSS fallback when native view transitions are unavailable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    Object.defineProperty(document, "startViewTransition", { value: undefined });
  });
  await page.goto(`${baseUrl}/about/`);
  await expect(page.locator("body")).toHaveCSS("transition-duration", "0.18s, 0.18s, 0.18s");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(9, 9, 11)");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
});

test("a skipped native reveal still applies the theme and allows the next click", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    Object.defineProperty(document, "startViewTransition", {
      value: (update: () => void) => {
        update();
        return { ready: Promise.reject(new Error("Snapshot skipped")), finished: Promise.resolve(), skipTransition() {} };
      },
    });
  });
  await page.goto(`${baseUrl}/about/`);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
  const canvas = page.locator("[data-wave-canvas]");
  const resumed = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).not.toBe(resumed);
});

test("fresh visits animate the canvas and the icons smoothly reflect saved pause state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`${baseUrl}/about/`);
  const canvas = page.locator("[data-wave-canvas]");
  const toggle = page.locator("[data-motion-toggle]");
  await expect(toggle).toHaveAttribute("aria-label", "Pause background");
  const pauseIcon = toggle.locator('[data-motion-icon="pause"]');
  const playIcon = toggle.locator('[data-motion-icon="play"]');
  await expect(canvas).toHaveAttribute("data-motion", "running");
  await expect(toggle).toHaveAttribute("data-motion-state", "running");
  await expect(pauseIcon).toHaveCSS("opacity", "1");
  await expect(playIcon).toHaveCSS("opacity", "0");
  await expect(playIcon).toHaveCSS("transition-duration", "0.18s, 0.18s");
  const initial = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).not.toBe(initial);
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-motion-state", "paused");
  await expect(toggle).toHaveAttribute("aria-label", "Resume background");
  await expect(playIcon).toHaveCSS("opacity", "1");
  await expect(pauseIcon).toHaveCSS("opacity", "0");
  const paused = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const afterFrames = await canvas.evaluate(async (node) => {
    for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
    return (node as HTMLCanvasElement).toDataURL();
  });
  expect(afterFrames).toBe(paused);
  await page.reload();
  await expect(canvas).toHaveAttribute("data-motion", "paused");
  await expect(page.getByRole("button", { name: "Resume background" })).toHaveAttribute("data-motion-state", "paused");
  await page.getByRole("button", { name: "Resume background" }).click();
  await expect(canvas).toHaveAttribute("data-motion", "running");
  const resumed = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())).not.toBe(resumed);
  await page.reload();
  await expect(canvas).toHaveAttribute("data-motion", "running");
});

test("reduced motion keeps a still background and skips all control animations", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(`${baseUrl}/about/`);
  const canvas = page.locator("[data-wave-canvas]");
  const toggle = page.getByRole("button", { name: "Background motion reduced" });
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("data-motion-state", "paused");
  await expect(toggle.locator('[data-motion-icon="play"]')).toHaveCSS("transition-duration", "0s");
  await expect(canvas).toHaveAttribute("data-motion", "paused");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-reveal", "true");
  await expect(page.locator("body")).toHaveCSS("transition-duration", "0s");
  expect(await page.evaluate(() => localStorage.getItem("waves-paused"))).toBeNull();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByRole("button", { name: "Pause background" })).toBeEnabled();
  await expect(canvas).toHaveAttribute("data-motion", "running");
});
