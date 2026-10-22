# ECR checkpoint and deployed image evidence

Related: [#83](https://github.com/Installity/cs4421-astro-blog/issues/83).
Observed read-only on 2026-10-22 in `us-east-1`; inventory is a dated snapshot.
No tags were created/moved and no service was updated.

## Week 6 checkpoint tag

`describe-images` and `batch-get-image` independently returned repository
`astro-blog`, tag `v1.0.0`, pushed 2026-10-07, with OCI index digest:

```text
sha256:d95f377988684a145aa73377e714e802287809e178689998cd21dafef45f223d
```

The index contains a `linux/amd64` image manifest
`sha256:d9021462d7c7b2863504bee59f064f178f1cfe729f19ac97d6d0ce5f3e7fe8bd`
and an attestation manifest with unknown/unknown platform. The latter is metadata,
not evidence of an additional runtime architecture. The literal ECR checkpoint
tag exists; an additional arbitrary retag is unnecessary.

A Git tag named `v1.0.0` currently resolves to source `71257ed`, but that name alone
does **not** prove that the older ECR checkpoint image was built from the same
revision. Historical provenance of that older artifact has not been established.
Do not use the checkpoint image as a known-good recovery candidate without
testing and identifying its source. Prefer the independently traceable tested
artifact below for current release/recovery planning.

## Current traceable deployed artifact

| Link in the chain | Observed evidence |
| --- | --- |
| Source | `71257edad69e57b1eb3296e3677a0e438870325f`, merge of PR #69 |
| Main release | [CI run 38268919052](https://github.com/Installity/cs4421-astro-blog/actions/runs/38268919052), push to main, completed successfully |
| Test/build/publish | Independently retrieved successful Validate project, Build/test/publish container, and Deploy/verify ECS jobs; Linux AMD64 build and Docker health steps passed before publishing |
| ECR tag | `sha-71257edad69e57b1eb3296e3677a0e438870325f-38268919052-1` |
| ECR digest | `sha256:c62f0868342929a4d13681fb04efb157571cfc8fa794af64eab6054ef1b9d315` |
| ECS | `default/astro-blog`, active task definition `default-astro-blog:13`, Linux/X86_64, primary container `Main` runs that exact repository digest |
| Runtime state | Active Express service; one desired/running task, no pending tasks, deployment COMPLETED when inspected |
| Health configuration | Port 4321 and Express `/api/health` path; distinguish service health configuration from a Docker health probe |

This links source, successful checks, registry metadata, and deployed configuration.
It does not establish uninterrupted rollout availability, a completed rollback,
or the student's personal execution of the original ECR exercise. Those have
their own evidence requirements.

## Recheck before using an artifact

Use the existing authenticated AWS session; never paste registry tokens into
evidence. These are read-only metadata requests:

```sh
aws ecr describe-images --repository-name astro-blog \
  --image-ids imageTag=v1.0.0 --region us-east-1
aws ecr batch-get-image --repository-name astro-blog \
  --image-ids imageTag=v1.0.0 --region us-east-1
aws ecs describe-task-definition --task-definition default-astro-blog:13 \
  --query 'taskDefinition.containerDefinitions[].{name:name,image:image}' \
  --region us-east-1
```

Re-read the current Express service's task definition first; revision 13 is this
snapshot, not a permanent pointer. Resolve a current SHA/run tag to a digest,
verify the associated checks and platform, then select the digest for a reviewed
release. A tag is a label; a digest identifies immutable image content. Unique
SHA/run tags aid investigation, while digest deployment avoids an ambiguous
mutable-name lookup.
