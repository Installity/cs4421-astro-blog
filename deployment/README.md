# Production delivery

- Static site: https://d2lpj15qx37gqq.cloudfront.net
- ECS site/API: https://as-2b62f684bea24081892fa30f44c134ca.ecs.us-east-1.on.aws
- Express service: `default/astro-blog`, account `873716897321`, region `us-east-1`.

The static workflow embeds the ECS `/api/news` URL during its build. Override
the default with the repository Actions variable `PUBLIC_NEWS_API_URL` if the
API moves. The ECS workflow adds the CloudFront origin to `NEWS_ALLOWED_ORIGINS`
while preserving existing origins and other container settings.

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
The pre-news image was `astro-blog@sha256:e6174cfb203069aa9b32c648777f228fba2a9c829cf911cd102e16bd18f7cd6d`.
