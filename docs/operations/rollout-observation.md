# Observe a reviewed ECS release

Related: [#82](https://github.com/Installity/cs4421-astro-blog/issues/82).
The probe is read-only. It does not merge, build, publish, deploy, or inject faults.

## Actual strategy, inspected 2026-10-22

`default/astro-blog` uses the ECS deployment controller with **CANARY** strategy,
5% initial canary traffic, three-minute canary bake and a three-minute bake
setting. Minimum healthy percentage is 100, maximum percentage 200; there is
currently one desired/running task. Circuit-breaker rollback and monitoring of
`default/astro-blog/RollbackAlarm` are enabled. Express health is `/api/health`,
container port 4321, current task definition `default-astro-blog:13`.

This configuration is direct evidence of the strategy, not observed zero
downtime. Do not describe the service as recreate, rolling, or an unverified
blue/green cutover solely because a deployment eventually completes.

## Observation procedure

1. Select a small release that already has peer approval and passing required
   checks. Record main's current source, ECR digest and service revision, target
   source PR and expected behavior. Retain the previous tested digest for
   recovery. Preserve the normal review and deployment gates.
2. Before merging, start a probe that will cover baseline, the entire release
   pipeline/canary/bake and post-release recovery/verification. For example:

   ```sh
   node deployment/observe_availability.mjs \
     --url https://as-2b62f684bea24081892fa30f44c134ca.ecs.us-east-1.on.aws/api/health \
     --samples 2400 > ecs-health-observations.jsonl
   ```

   In a separate terminal, observe a representative rendered route too:

   ```sh
   node deployment/observe_availability.mjs \
     --url https://as-2b62f684bea24081892fa30f44c134ca.ecs.us-east-1.on.aws/ \
     --kind page --samples 2400 > ecs-page-observations.jsonl
   ```

   Keep generated observation files outside Git unless sanitized and deliberately
   selected as public evidence. Extend the sample count if the release outlasts
   this window. The default interval is one second, timeout five seconds; slow
   attempts reduce cadence because requests are sequential. Record actual
   timestamps/gaps, probe-host/network health and the planned/observed count.
3. The student merges only after the normal peer/CI gates. Record the actual
   main run, source SHA, published unique tag/digest, ECS/task revision and service
   events. Observe canary progress, alarm state, desired/running/healthy tasks
   and release completion; do not force another deployment just for evidence.
4. Verify the intended behavior on the live service, then retain sufficient
   post-release samples. Reconcile the observed interval with the full rollout.
   If the probe stops early, returns errors or misses the rollout, report that
   limit. An interrupted/incomplete or failing run exits nonzero and still emits
   its summary; never discard failed samples to improve the result.
5. Record UTC times, requests/failures/content checks, latency and coverage gaps,
   plus source → tested image → ECS revision. Cross-check platform error/health
   metrics where available. Final HTTP 200 alone cannot close #82.

## Interpretation

Zero failed observations over the release interval supports **no downtime
observed at this sampling cadence and location**. It cannot prove that every
reader or sub-second interval was unaffected. The health probe checks 200/JSON,
`status=ok` and numeric uptime. The page probe checks 200 and a main element;
neither certifies all assets, news freshness, or complete browser rendering.
Record target URLs, time bounds and actual traffic observations rather than
turning a small sample into a historical SLO claim.

Only the actual strategy and the local probe behavior are verified by this
change. Live release observation remains pending a reviewed merge; #82 stays open.
