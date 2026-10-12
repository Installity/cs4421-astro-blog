# Theme and background controls

Reviewed on 12 October 2026 at desktop (1440px) and mobile (390px) widths.
The moon switches theme, while pause/play shows the available background action.
The new theme expands from the moon control over 480 ms. Browsers without native
view transitions use a short color fade; reduced-motion preferences skip both.

Fresh visits animate the background. An explicit saved pause is retained, and
system reduced motion keeps the canvas still without saving a pause preference.

- [Desktop: light, running](blog-1440-light-running.jpg)
- [Desktop: dark, paused](blog-1440-dark-paused.jpg)
- [Mobile: light, running](blog-390-light-running.jpg)
- [Mobile: dark, paused](blog-390-dark-paused.jpg)
- [Circular theme reveal, intermediate frame](theme-circular-reveal.jpg)

Validation: lint, Astro checks (zero errors/warnings), 31 unit tests, 50
Chromium/WebKit browser tests, 8 existing CDK tests, static and server builds.
The compiled server passed a health check and four browser smoke tests covering
native reveal and actual changing canvas frames. Coverage also includes keyboard
operation, pause persistence, reduced motion, rapid toggles, skipped snapshots,
and the CSS fallback. The existing Zod deprecation hint is unchanged.

These changes are isolated from the portrait/domain fixes and are not deployed.
