# Andrei Turcan — Software Notes

A personal Astro blog about building software, learning through prototypes, and following technology news. The site combines project writing with a portfolio-inspired cream/charcoal design, red accents, locally hosted Geist fonts, and animated dotted waves.

## Content and experience

- **Home, Blog, and About:** two first-person software articles exploring Velsat’s CanSat sensor integration and radio telemetry, and ExGlass’s camera processing, classification, alerts, and prototype limitations.
- **Reading tools:** search, topic filters, reading time, author profiles, related articles, RSS, and a sitemap.
- **Tech News:** publisher-filtered headlines from TechCrunch, The Verge, Ars Technica, Irish Tech News, TechCentral.ie, and TechBuzzIreland, with six recent headlines on Home. Links open the original publisher articles.
- **Accessibility:** responsive layouts, light/dark themes, keyboard navigation, and background animation that can be paused and respects reduced-motion preferences.

## Technical design

Astro components and shared layouts render typed Markdown/MDX content collections. Native browser scripts handle themes, canvas animation, and news interactions; TypeScript supports the application and AWS CDK infrastructure.

The Node server exposes `GET /api/news`, using native `fetch` and `rss-parser` for RSS/Atom. Six fixed feeds are fetched concurrently with an eight-second timeout and a 2 MB limit per source. Headlines are normalized, deduplicated, and sorted; output uses plain text and HTTP/HTTPS links. Each source has a 15-minute memory cache, shared refresh requests, and up to 24 hours of stale data after failures. Partial outages retain working sources. Caches reset on restart and are independent across instances.

News loads on page entry and refreshes every 15 minutes while the tab is visible. There is no scheduled polling without visitors.

## Running and configuration

Use Node.js 22.12 or newer:

```sh
npm ci
npm run dev -- --background
```

Manage the preview with `npx astro dev status`, `npx astro dev logs`, and `npx astro dev stop`.

`npm run build` produces a static site. `ASTRO_OUTPUT=server npm run build` produces the Node server, including `/api/news` and `/api/health`; the Dockerfile uses this server configuration.

Server deployments use same-origin news requests. Static builds require `PUBLIC_NEWS_API_URL`, set before building to a complete HTTPS endpoint on a running server. Set that server’s `NEWS_ALLOWED_ORIGINS` to the permitted static-site origins, separated by commas. Without an API URL, static pages display a clear unavailable state. See [.env.example](.env.example).

## Demonstrating the SDLC

This repository demonstrates requirements planning, implementation, verification, delivery, and maintenance: project reports inform the articles; shared components and typed schemas organize the design; feature branches and pull requests make changes reviewable.

GitHub Actions runs lint, Astro checks, unit tests, Chromium/WebKit browser tests, production builds, CDK tests/synthesis, and container health checks. Feed fixtures cover parsing, caching, timeouts, and outages; browser checks cover navigation, filtering, themes, and responsive layouts. Run `npm run lint`, `npm run check`, and `npm test` locally after installing CDK dependencies with `npm ci --prefix cdk`.

Main-branch workflows handle the static AWS CDK deployment and publish tested container images to ECR using OIDC. Publishing an image is separate from deploying a running API. [Review screenshots](docs/verification/README.md) document the redesigned interface.
