# Verify ECS application request-log delivery

Related: [#74](https://github.com/Installity/cs4421-astro-blog/issues/74).
Dependency: [logging PR #93](https://github.com/Installity/cs4421-astro-blog/pull/93)
must be reviewed, merged and deployed before its request records can be verified.

## Read-only inventory, 2026-10-22

ECS `default/astro-blog`, task family revision `default-astro-blog:13`, container
`Main`, is already configured with the `awslogs` driver:

| Setting | Observed value |
| --- | --- |
| Region | `us-east-1` |
| Application log group | `/aws/ecs/default/astro-blog-73b7` |
| Stream prefix | `ecs` |
| Stream naming | `ecs/Main/<task-id>` |
| Example inspected stream | `ecs/Main/551d05326e48454a9a02ea79eaf4b728` |
| Retention | No `retentionInDays` set (logs do not expire automatically) |
| Current image digest | `sha256:c62f0868342929a4d13681fb04efb157571cfc8fa794af64eab6054ef1b9d315` |

The bounded latest-stream read returned three platform/startup events and no
`http_request` JSON records. This establishes a working log route, not structured
request ingestion. Do not add a duplicate group/driver to address missing
application logging. The CDK deployment-Lambda log group serves a different
purpose. Retention is an explicit future owner decision; this change does not
silently change managed logging or claim a 30-day retention setting.

## Post-release verification

1. Record the merged source revision, successful main CI/publish/deploy run,
   resulting ECR digest, and active Express task definition. Confirm they contain
   PR #93; a green PR run does not publish an image.
2. Read that task's `logConfiguration` and find the matching `ecs/Main/<task-id>`
   stream. Use the application group above only if the current task still names
   it. Record actual retention and ingestion timestamps.
3. Note a UTC start time and make a few normal requests to ECS `/api/health`.
   Retain HTTP status/body and the observation interval. Avoid intentionally
   failing production requests merely to manufacture a log sample.
4. Query a bounded interval around those requests and compare method, route,
   numeric status/latency, generated IDs, event times and stream/task identity.
   Expect one record per request that reaches Astro, allowing normal ingestion
   delay. Check duplicates and ensure private query/header values are absent.
5. Run the error filter too. Zero errors can be a valid result; it is not proof
   of a broken query or a completed failure drill. Use representative controlled
   non-production failures for error-path testing.

In CloudWatch Logs Insights, select the actual group and exact UTC bounds:

```sql
fields @timestamp, @logStream, event, requestId, method, route, statusCode, latencyMs
| filter event = "http_request" and route = "/api/health"
| sort @timestamp desc
| limit 20
```

```sql
fields @timestamp, @logStream, requestId, route, statusCode, latencyMs
| filter event = "http_request" and statusCode >= 500
| sort @timestamp desc
| limit 20
```

The equivalent JSON metric-filter expression is `{ $.statusCode >= 500 }`;
do not paste it as a Logs Insights query. Inspect existing metrics/alarms before
adding another filter. Record query ID, bounds, scan/ingestion information,
sanitized results, source/image identity and expected-versus-observed counts.

## Completion gate

The existing driver/group is verified. Deployed request correlation, structured
field querying and privacy checks remain open pending the logger's release.
Do not close #74 from this runbook or from startup logs alone. An application
request log also does not establish an alarm, browser/edge availability, or
automatic recovery.
