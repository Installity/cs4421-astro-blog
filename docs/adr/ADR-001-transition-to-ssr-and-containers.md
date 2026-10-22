# ADR-001: Retain static delivery and add a containerized Astro server

- Status: Proposed for review; records the architecture already implemented
- Recorded: 2026-10-22 (not the date the original implementation was approved)
- Related requirement: [issue #72](https://github.com/Installity/cs4421-astro-blog/issues/72), week 5 architecture decision; week 7 ECS delivery

## Context

The blog's articles, author profiles, and navigation can be generated at build
time. News headlines depend on remote RSS/Atom publishers and must update
without rebuilding the blog. S3 serves objects; it cannot execute Node code or
fetch and aggregate feeds on behalf of a request. A browser-only aggregator would
also depend on each publisher's CORS policy and duplicate parsing/network work.

The assessment includes both a live static site and a live container application
with a health endpoint. Week 7 explicitly uses ECS. This decision records the
actual hybrid architecture rather than replacing it with the introductory App
Runner roadmap.

## Decision

Keep one source tree with two build outputs selected in
[`astro.config.mjs`](../../astro.config.mjs):

| Build | Delivery and behavior |
| --- | --- |
| Default `npm run build` | Static HTML/assets in `dist`, published to private S3 through CloudFront |
| `ASTRO_OUTPUT=server npm run build` | Standalone `@astrojs/node` server, including dynamic news and health routes, packaged in Docker and hosted by ECS |

CloudFront is the preferred public/canonical site. The static browser reads the
ECS `/api/news` endpoint using the build-time `PUBLIC_NEWS_API_URL`. A server
build uses same-origin requests. `NEWS_ALLOWED_ORIGINS` controls which additional
browser origins may read the news response; CORS is not authentication.
`PUBLIC_SITE_URL` controls canonical, RSS, and sitemap URLs at build time. See
[the configuration example](../../.env.example).

[`src/api/news.ts`](../../src/api/news.ts) is injected as a runtime route for
server/development builds. It aggregates six fixed publisher feeds, normalizes
and deduplicates headlines, and returns 503 when there are no usable headlines.
[`src/lib/news.ts`](../../src/lib/news.ts) limits source response size and fetch
duration, caches each feed for 15 minutes, and allows up to 24 hours of stale
headlines after errors. Cache state is in process memory: it resets on restart
and is independent for each replica. This is a cache, not durable storage or a
globally synchronized scheduler.

[`/api/health`](../../src/pages/api/health.ts) reports process liveness with
status, uptime, and timestamp. It does not check every publisher, prove news
freshness, or certify readiness of all external dependencies. A cached/static
health file does not demonstrate a running Node process.

[`Dockerfile`](../../Dockerfile) builds the server in one stage, prunes development
dependencies, and copies the compiled application and production dependencies to
a non-root Node runtime. It binds to port 4321 and probes `/api/health` using
Node's HTTP client. Runtime configuration must not be baked into image layers as
credentials. [`.dockerignore`](../../.dockerignore) excludes environment files,
credentials, generated output, and other unnecessary build inputs.

## Delivery and recovery

- [`cdk/lib/cdk-stack.ts`](../../cdk/lib/cdk-stack.ts) versions static infrastructure:
  encrypted private S3, CloudFront OAC/HTTPS, directory-index rewriting, asset
  deployment, and CDN invalidation. The retained bucket protects content on stack
  deletion; it is not a complete backup or rollback mechanism.
- [Static delivery](../../.github/workflows/deploy-static.yml) builds on main and
  deploys through CDK using encrypted GitHub secrets. [Container CI](../../.github/workflows/ci.yml)
  validates PRs, tests the built image, and publishes/deploys only on main pushes.
  Container publishing/deployment uses GitHub OIDC. These are different credential
  mechanisms; neither requires putting credentials in source.
- ECR images have unique source/run tags; ECS receives the immutable digest of
  the tested image. [`deployment/deploy_ecs.py`](../../deployment/deploy_ecs.py)
  preserves the Express service's container settings and waits for stable tasks
  running the requested image. A successful final health check does not by itself
  prove zero downtime during rollout.
- A static recovery uses a reviewed revert and deployment/CDN invalidation.
  Container recovery selects a previously tested digest and preserves health,
  port, and environment settings. Do not treat the historical image in the
  deployment notes as a current known-good image without checking it. Timed
  rollback and availability observations require their own evidence.

## Alternatives considered

| Alternative | Tradeoff and reason not selected |
| --- | --- |
| Static only, rebuilding for each news update | Simple hosting, but no runtime aggregation and feed freshness depends on builds |
| Browser fetches directly from publishers | Less server operation, but publisher CORS, inconsistent formats, and repeated parsing constrain it |
| Entire site served only by Node/ECS | One runtime origin, but adds runtime dependency for static reading and loses the separately assessed static deployment |
| Static site plus serverless aggregator | Plausible alternative with per-invocation scaling, but adds a different execution/deployment model; ECS already meets the container milestone |

## Consequences and outstanding verification

Static articles remain inexpensive to cache and available independently of the
news process. One application codebase supports both outputs. Immutable artifacts
and versioned static infrastructure make releases explainable and recoverable.

The tradeoff is two delivery paths, cross-origin configuration, container compute,
image registry/load-balancing/logging costs, and a Node process that needs
patching and observation. Cache state differs between replicas; scaling can
increase publisher traffic and produce temporarily different headline sets.
CDN content and embedded API URLs update only after a static deployment and
invalidation. Memory caching does not replace durable persistence if future
requirements need it.

Request logging, CloudWatch ingestion/alarms, measured availability, and timed
recovery are tracked in issues #73–76, #81–85. Those are operational work and
evidence gaps, not capabilities established by this ADR. There is no claim of
historical SLO attainment, automatic alarm-driven rollback, peer approval, or a
completed defense. The student must be able to explain and demonstrate the
architecture after review.
