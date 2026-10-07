# Redesign verification

Reviewed on 7 October 2026. Screenshots show the final layouts at 1440px and
390px in light and dark themes. News uses a deterministic sample headline for
layout verification; the live feeds were checked separately in the local
server container. The screenshots use reduced motion to keep the background
composition stable.

- [Desktop light](home-1440-light.jpg)
- [Desktop dark](home-1440-dark.jpg)
- [Mobile light](home-390-light.jpg)
- [Mobile dark](home-390-dark.jpg)
- [Article](article-1440-light.jpg)
- [News](news-390-dark.jpg)

Validation: 30 unit tests, 36 Chromium/WebKit browser tests, 8 existing CDK
tests, lint, Astro checks, static builds with and without an external API URL,
server build, existing CDK synthesis, and a local Linux AMD64 container build. The container's health
check passed; its live API returned headlines with per-source status and the
configured CORS origin. Static output contains only the two project article
routes in RSS and includes both articles plus News in its sitemap.

No AWS resources were changed and no site or API was deployed. Static news
requires PUBLIC_NEWS_API_URL at build time and NEWS_ALLOWED_ORIGINS on a
running API server.
