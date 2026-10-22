# Reliability objectives and release policy

Recorded 2026-10-22. Proposed targets for review, not measured achievements.
Related: [#75](https://github.com/Installity/cs4421-astro-blog/issues/75),
[logging #73](https://github.com/Installity/cs4421-astro-blog/issues/73),
[CloudWatch verification #74](https://github.com/Installity/cs4421-astro-blog/issues/74),
[alarms #76](https://github.com/Installity/cs4421-astro-blog/issues/76).

## Scope and indicators

The CloudFront static blog and ECS Node application are separate delivery paths.
A healthy Node process does not prove that a reader can load the static site or
obtain fresh news. Measure them separately over a rolling 30-day UTC window.
The owner reviews targets after collecting an initial baseline; the values below
are chosen for this small course service, not mandated slide values.

| Indicator | Data source and calculation | Proposed objective | Limitations |
| --- | --- | --- | --- |
| Static reading availability | External probe every 60 seconds loads CloudFront `/` and `/blog/`; an observation is good only if both return 200, expected page content, and complete within 5 seconds. Good observations / all scheduled observations | At least 99.5% over 30 days | Not implemented as a persistent probe yet; two routes are a sample, not every asset/article or user location |
| ECS process liveness | External 60-second `/api/health` probe requires 200, JSON `status=ok`, numeric uptime, and completion within 5 seconds. Good observations / scheduled observations | At least 99.5% over 30 days | Process liveness, not publisher readiness or static delivery; a static health file is not a Node probe |
| News response availability | GET `/api/news` completion logs from the ECS application plus upstream/load-balancer errors as a separately reconciled source. Good = 2xx; denominator = all completed application GETs to that route, including 4xx/5xx | At least 99% over 30 days | Application logs miss pre-Astro failures, crashes and interrupted streams. Until edge reconciliation exists this is an application-response indicator, not full user availability |
| News response latency | Same completed GET population, counting a response good only when it is 2xx AND `latencyMs <= 1000`; good / all completed GETs | At least 95% over 30 days | Middleware timing measures response generation, not body transfer or user-perceived time. Cold publisher fetches may take up to 8 seconds; validate feasibility with a baseline |
| Publisher freshness (diagnostic) | Sample `/api/news` source records and `lastSuccessfulFetch`; report counts of fresh, stale and unavailable sources and per-source age | No initial SLO; investigate increasing stale/unavailable samples | A successful 200 can contain stale headlines; upstream failure and the site's availability are different. `checkedAt` is not proof of a fresh publisher fetch |

For external probes retain the scheduled slots, observation times, HTTP/content
result, elapsed time, and probe-runner health. A missing scheduled result is
unknown, not a success. Display coverage separately; report a conservative
attainment bound counting unknown slots as bad. Do not claim an SLO met unless
coverage and the bound support it. Do not combine independent series as if they
were the same denominator.

For request-based indicators report zero-request windows as **no data**, not
100% success. Empty log queries also require an ingestion/coverage check.
Exclude synthetic probes from user-traffic series by collecting them separately;
health-route traffic is already outside the `/api/news` route population. A
conditional percentile is a useful diagnostic, but does not replace the explicit
good-request fraction (fast errors are not good latency observations).

## Error budgets

For an objective `S`, denominator `N`, and good observations `G`:

```text
allowed bad fraction = 1 - S
bad observations = N - G
budget = N * (1 - S)
remaining budget = budget - bad observations
burn ratio = (bad observations / N) / (1 - S)   # only when N > 0
```

At 60-second sampling, a complete 30-day window contains 43,200 slots. A 99.5%
objective permits 216 bad slots (3 hours 36 minutes of sampled opportunity,
not a precise outage duration between probes). For 10,000 completed news GETs,
99% permits 100 bad responses; the 95% combined success/latency objective permits
500 bad observations. These are arithmetic examples, not project measurements.
Keep separate budgets for each objective; unused static budget cannot cancel
news failures.

## Measurement procedure

After #73 is reviewed, released, and #74 verifies ingestion, select the actual
ECS application log group and the exact UTC start/end times. This Logs Insights
query computes the application-response indicators from its JSON fields:

```sql
fields @timestamp, event, method, route, statusCode, latencyMs
| filter event = "http_request" and method = "GET" and route = "/api/news"
| stats count(*) as total,
    sum(if(statusCode >= 200 and statusCode < 300, 1, 0)) as good,
    sum(if(statusCode >= 200 and statusCode < 300 and latencyMs <= 1000, 1, 0)) as fastGood,
    pct(latencyMs, 95) as diagnosticP95Ms
```

Calculate `good / total`, `fastGood / total`, and their budgets only when `total`
is positive. Retain query ID/time bounds, log group, source/image revision,
counts, and ingestion coverage checks. Query syntax and live results must be
verified in #74/#76; this document does not claim a deployed dashboard or alarm.
Inspect HTTP 5xx/target/latency metrics on the actual load balancer to detect
failures that application records cannot see. CPU/memory are saturation signals,
not substitutes for user availability. Reconcile missing layers before claiming
end-to-end attainment.

## Release and recovery policy

- When coverage is adequate and budgets are healthy, continue small reviewed
  releases with required CI and observation. Record source → tested image digest
  → deployed service plus static revision separately.
- If a budget is more than half spent, investigate recent releases, log patterns,
  feed outages, and saturation before accepting more avoidable reliability risk.
  Review the rate of consumption, not just its remaining percentage.
- If any budget is exhausted, pause discretionary feature releases. Prioritize
  restoration and reliability fixes through the same review/CI process; security
  and recovery work may proceed with explicit risk assessment. Resume feature
  work only after corrective actions and a reviewed recovery/budget decision.
- If telemetry is missing, restore observation first and label the result
  unknown. Missing data cannot establish a healthy budget. An error alarm is a
  rapid detection mechanism; this rolling-window policy is a release decision.
- Recovery is operator initiated unless verified alarm actions prove otherwise.
  A container rollback uses a prior tested digest. A static rollback uses a
  protected revert/deployment and CDN invalidation. The separate course drills
  target less than 60 seconds and less than two minutes respectively; neither
  timing is claimed here.

## Baseline and ownership

No 30-day production baseline, sustained probe coverage, query result, or alarm
transition was verified for this change. Prior point-in-time 200 responses and
successful CI runs cannot establish an SLO. AWS inspection on 2026-10-22 was
blocked by an expired login. #74 and #76 retain the ingestion/metrics work; #82
retains rollout availability evidence.

The repository owner operates the service and reviews the targets, query
population, probe coverage, and budget at each release and retrospective. Peer
review should challenge whether 99.5%/99%/95% are useful and achievable once a
baseline exists. Amend targets prospectively with the reason and date; do not
lower a target retrospectively to disguise an incident.
