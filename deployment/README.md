# Production delivery

See the [reliability objectives and release policy](../docs/operations/reliability.md)
for separate static, process-health, news-availability and latency indicators,
their proposed budgets, and the outstanding measurement work.

- Static site: https://d2lpj15qx37gqq.cloudfront.net
- ECS site/API: https://as-2b62f684bea24081892fa30f44c134ca.ecs.us-east-1.on.aws
- Static custom domain target: https://andreitrn.me
- ECS custom domain target: https://ssr.andreitrn.me
- Express service: `default/astro-blog`, account `873716897321`, region `us-east-1`.

Complete the [certificate/routing/DNS cutover runbook](../docs/operations/custom-domains.md)
before treating the custom addresses as live. The two AWS URLs stay available.

The static workflow embeds the ECS `/api/news` URL during its build. Override
the default with the repository Actions variable `PUBLIC_NEWS_API_URL` if the
API moves. The ECS workflow adds CloudFront, `https://andreitrn.me` and
`https://www.andreitrn.me` to `NEWS_ALLOWED_ORIGINS`, while preserving existing
origins and other container settings. Verification requests each origin separately
and requires its exact CORS response; a comma-separated list is not a valid Origin
request header. The static API default stays on the working AWS endpoint until
the ECS custom hostname is ready, then `PUBLIC_NEWS_API_URL` can switch it to
`https://ssr.andreitrn.me/api/news` on a subsequent static build.

On a merge/push to `main`, CI validates the application and container, publishes
an immutable ECR image, then runs `deploy_ecs.py`. It waits for any existing
rollout before updating, and requires completed ECS deployment, running tasks,
and the requested image before checking `/api/health` and `/api/news`. PRs only
validate; they do not publish or deploy. Main runs are serialized so an update
is not interrupted by a later merge. Feed outages can fail the final API check
even when the application deployment itself is healthy.

`github-ecs-policy.json` is the supplemental inline policy on
`GitHubActionsAstroECR` named `DeployAstroBlogService`. It grants inspection/update
of this service, registration of revisions within its `default-astro-blog` task
family, and passing its existing task role only. Express service updates require
the task registration permission even though the workflow calls only the Express
update API. The ECR publishing policy and main-branch OIDC trust remain in place.
If restoring the role:

```sh
aws iam put-role-policy --role-name GitHubActionsAstroECR \
  --policy-name DeployAstroBlogService \
  --policy-document file://deployment/github-ecs-policy.json
```

For rollback, update the Express service to a previously tested ECR digest and
retain the existing container port, health path, environment, and other settings.
Use the [manual GitHub recovery runbook](../docs/operations/ecs-rollback.md) for
the **Rollback ECS** workflow: preview or execute an ongoing-deployment rollback,
or restore a prior tested release image without rebuilding. It needs the reviewed
supplemental rollback policy on the existing OIDC role before use. Select a fresh,
verified known-good release; a historical image mentioned in notes is not enough.
