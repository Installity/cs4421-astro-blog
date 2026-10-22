# Application request logs

Related: [#73](https://github.com/Installity/cs4421-astro-blog/issues/73).

The Node application emits one JSON line to stdout for each on-demand request
that reaches its Astro middleware. Records contain `timestamp`, `event` set to
`http_request`, `requestId`, `level`, HTTP `method`, route pattern `route`, numeric
`statusCode`, and numeric `latencyMs`. Error responses (500+) use `error`, client
errors (400+) use `warn`, and other responses use `info`.

Route patterns deliberately replace raw paths: a future `/blog/[...slug]` request
does not leak the slug, and unmatched routes use `[unmatched]`. Queries, bodies,
headers, cookies, IP addresses, and exception messages/stacks are not included.
IDs are generated locally rather than trusting a client-supplied value. The
record is diagnostic context; it is not a payload/exception dump.

The middleware preserves handled responses, including news-service 503 errors.
A thrown handler failure becomes a generic HTTP 500 with the safe
`unhandled_request_error` code. No exception text is returned or added to the
structured record. The application currently has no custom 500 renderer.

`latencyMs` measures middleware entry through response generation using a
monotonic clock. It excludes body streaming, network transfer, CloudFront, and
browser rendering. An error after streaming starts or a process crash may not
produce a completed record. Requests handled before Astro (assets, proxy or
platform rejection) need platform/access telemetry. Static prerendering is
excluded so build output cannot masquerade as production traffic. These are
application logs, not an exhaustive edge access log.

For local observation, build with `ASTRO_OUTPUT=server npm run build`, run
`HOST=127.0.0.1 PORT=4321 node dist/server/entry.mjs`, and request `/api/health`.
The response stays JSON while stdout contains the independent request record.
Stop only the server you started. Do not add a permanent failure route just to
test logging; automated tests supply failing handlers.

CloudWatch ingestion is a separate deployment verification in #74. After this
change is reviewed, merged and released, inspect the actual ECS application log
group/stream and correlate real requests. A local record, a JSON health response,
or a successful CI run does not prove CloudWatch delivery or configured alarms.

## Local verification, 2026-10-22

The compiled standalone server produced exactly three structured records for
three HTTP requests: `/api/health` returned 200/JSON, `/api/news` returned 503 with
empty items when a temporary test-only fetch stub rejected all publishers, and
an unknown URL returned 404 (logged as Astro's `/404` route pattern). Test query
and header values and the unknown path were absent from the records. The server
and stub were stopped/removed from the exercise; no failure route or production
change was introduced. This observes local behavior, not deployed CloudWatch.
