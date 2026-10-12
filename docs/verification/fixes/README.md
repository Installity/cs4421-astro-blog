# Portrait and public URL fixes

Reviewed on 12 October 2026. The author portrait now comes from a local image
and is optimized into the static and server builds. Its old LinkedIn URL expired
on 8 October and returned HTTP 403. CloudFront is the preferred public URL;
canonical metadata, RSS, and the sitemap now use it instead of example.com.

- [Desktop light portrait](portrait-1440-light.jpg)
- [Mobile dark portrait](portrait-390-dark.jpg)

Validation: 31 unit tests, 40 Chromium/WebKit browser tests, 8 CDK tests, lint,
Astro checks, static and server builds, and a compiled-server health/portrait
check. Also verified a custom site URL loaded from `.env`. The local Docker
daemon was unavailable; the PR's existing CI job builds and health-checks the
container. These screenshots use reduced motion to keep the composition stable.
