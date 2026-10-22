# Application error alarm and recovery ownership

Related: [#76](https://github.com/Installity/cs4421-astro-blog/issues/76).
Read-only inventory on 2026-10-22, ECS `default/astro-blog`, `us-east-1`.
No alarms, actions, thresholds or deployment settings were changed.

## Existing detection

The service already has an application-error alarm:

| Setting | Observed value |
| --- | --- |
| Alarm | `default/astro-blog/RollbackAlarm` |
| State at inspection | OK |
| Source | AWS/ApplicationELB target 4xx, target 5xx and RequestCount for both service target groups |
| Per-target expression | `100 * (IF(4xx < 5, 0, 4xx) + 5xx) / FILL(total, 1)` |
| Combined expression | Maximum of the two target-group error percentages |
| Condition | Greater than 1%, 2 of 3 one-minute periods |
| Missing data | `notBreaching` |
| Direct alarm/OK actions | Empty lists |
| ECS deployment integration | Alarm monitoring enabled and rollback enabled for this alarm |

The underlying target groups are
`ecs-gateway-tg-dcabfcd19767a587d/dd33bd019c0427bc` and
`ecs-gateway-tg-469558adb78f10478/2a9c4994559f266e`, scoped to the service's
`ecs-express-gateway-alb-d8589443/82be183e8dbba502` load balancer. Re-read the
current alarm before querying; managed Express deployment resources can change.

This metric is not identical to a pure server-5xx SLI: fewer than five 4xx in a
period are ignored, larger 4xx counts are included, and the maximum target-group
percentage can expose canary errors hidden by an overall average. With low
traffic, one error can be significant. No traffic or telemetry loss is treated
as non-breaching; **OK is not proof of ingestion or service availability**.
Use independent health/coverage observation to detect silence.

Two additional AWS/ECS CPUUtilization target-tracking alarms control autoscaling
(high threshold 60, low threshold 54). A low-CPU ALARM can mean scale-in demand;
it does not indicate an application outage. Keep CPU/memory saturation separate
from response errors, latency and process liveness.

## What recovery is automatic

The ECS deployment configuration lists this alarm with `enable=true` and
`rollback=true`. It also enables the deployment circuit breaker with rollback.
During a monitored deployment, ECS can use these mechanisms to roll back a bad
release. Empty direct `AlarmActions` does not negate the ECS integration.
Conversely, it does not establish a notification destination or general
alarm-driven recovery outside a deployment. Operator diagnosis and restoration
remain necessary where no verified automatic action applies.

The service currently uses CANARY, 5% canary traffic with a three-minute canary
bake, and a three-minute bake setting. Do not describe it as a simple rolling
replacement or claim a sub-minute end-to-end detection/release path. The
2-of-3-minute alarm evaluation and deployment bake mean the separate under-60s
rollback checkpoint needs explicit timing boundaries and real measurement.

## Historical evidence and controlled verification still needed

Read-only alarm history returned real OK → ALARM transitions at
2026-10-20 17:46:12 UTC and ALARM → OK at 17:53:12 UTC, plus earlier transitions.
These establish state changes, not their cause, an intentional exercise, or a
successful automatic rollback. Do not relabel them as a student-performed drill.

For a controlled verification, first select an authorized environment/change,
identify the prior tested image, required review gates, probe, recovery command,
observer and stop conditions. Record actual metric windows and coverage, alarm
state/reason, failed probe, rollout state, recovery action and user-visible
recovery timestamps. Preserve the managed alarm; setting its state manually
would not test the metric/error path. Do not inject production failures as part
of this documentation change.

Use the reliability targets in #75 when reviewing alert sensitivity; the current
alarm is a rapid deployment signal, not proof of a rolling 30-day budget. #74
must verify application logs after #73 is released. Live latency/source coverage,
controlled alarm exercise and recovery observations remain requirements for
closing #76; this inventory alone does not close it.
