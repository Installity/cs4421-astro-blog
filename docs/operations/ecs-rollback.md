# Manual ECS recovery from GitHub

`Rollback ECS` restores an existing tested artifact without an application build,
Docker build, ECR push, or full CI run. The reviewed recovery workflow runs only
from `main`, authenticates through the existing AWS OIDC role, and targets only
`default/astro-blog` in account `873716897321`, region `us-east-1`.

As the operator, I want automatic or manual selection of a verified recovery image
so that I can recover without searching ECS for an image tag while retaining an
explicit override.

| Mode | Use | Result |
| --- | --- | --- |
| `ongoing` | Exactly one deployment is PENDING or IN_PROGRESS | Ask ECS to roll that deployment back to its previous service revision; require that revision to contain the selected known-good image |
| `restore-image` | Deployment has finished, with no ongoing operation | Start a new Express deployment of the selected digest, preserving the current container configuration except its image |

An ongoing rollback can reuse the previous revision. Restoring an image after a
completed release still needs ECS startup, health checks and traffic shifting.
Runner startup and AWS operations take time: this workflow does not guarantee
sub-minute recovery. [AWS's ongoing-deployment rollback procedure](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/stop-service-deployment.html).

## Choose the image

The **image_selection** dropdown is independent of the recovery **mode**:

| Selection | What to enter | How the image is verified |
| --- | --- | --- |
| `automatic` (Actions default) | Leave `image_tag` empty | For `ongoing`, resolve the deployment's single source revision. For `restore-image`, identify the current digest from successful ECS history matching the current task definition, then select the most recent successful deployment with a different digest. Resolve its existing pipeline tag and verify the exact successful main-push CI run/attempt and ECR digest. |
| `manual` | Enter `sha-<40-character-commit>-<run-ID>-<attempt>` | Apply the existing CI-run/ECR checks and require the ongoing source digest or a successful historical ECS deployment to match. |

Both choices retain preview-by-default and the **Execute recovery** checkbox.
Automatic selection chooses an image; it does not automatically initiate recovery
when an alarm fires. A tag is required only for manual selection. Git tags and ECR
tags such as `v1.0.0`/`latest` do not satisfy the pipeline provenance check.

The Actions summary shows the chosen tag, immutable digest, source commit and
successful CI-attempt link without downloading an artifact. The complete plan is
also retained. Automatic selection resolves afresh on every dispatch and is
rechecked within an executing run. To execute the exact image from an earlier
preview, choose `manual` and copy that preview's tag.

Known good means previously deployed and CI-verified; those checks cannot prove
the absence of all bugs. History is ordered by deployment creation time, not commit
age. Following a manual restoration, the previous different image can therefore
contain a newer commit than the currently running image. Review the summary and
use manual selection when a specific older release is required.

Automatic selection stops on ambiguous/missing history, an unproven current image,
no different successful image, missing ECR data, tag drift, or missing CI
provenance. It does not silently skip an unverifiable deployment for a much older
one. If multiple pipeline tags label the same digest, it can use another verified
tag of those same bytes; AWS/GitHub access failures still stop the operation.
No additional IAM actions or persistent release-pointer storage are required.

Acceptance checks:

- Given an eligible ongoing deployment, when Automatic is selected with no tag,
  then its exact source image is verified and displayed.
- Given a completed deployment, when Automatic is selected, then repeated/current
  digests and unsuccessful deployments are excluded from the previous-image choice.
- Given Manual selection without a pipeline tag, or Automatic with a tag, then
  preflight rejects the conflicting inputs without an ECS mutation.
- Given an unverified candidate or changed plan, then recovery stops. Given preview,
  then no ECS change is requested for either selection method.

## Enable after peer review

1. Review and merge the workflow/helper/tests into `main`. GitHub's manual
   workflow button requires the workflow on the default branch.
2. An AWS administrator must review and apply
   [`deployment/github-rollback-policy.json`](../../deployment/github-rollback-policy.json)
   as an **additional** policy on the existing OIDC role. The existing ECR and
   `DeployAstroBlogService` policies remain required. The new policy grants
   deployment inspection/stop and image lookup for this service/repository only;
   the workflow cannot edit IAM or grant itself permissions. Applying this
   repository change does not apply the AWS policy automatically.

   ```sh
   aws iam put-role-policy --role-name GitHubActionsAstroECR \
     --policy-name RollbackAstroBlogService \
     --policy-document file://deployment/github-rollback-policy.json
   ```

   If `AWS_ECR_ROLE_ARN` overrides the default, apply the reviewed policy to that
   actual role instead. Retain its existing main-branch OIDC trust restriction.
3. Perform a preview with a recorded good release tag and review the artifact
   before an agreed live recovery rehearsal. A preview exercises read access;
   it does not prove `StopServiceDeployment` will succeed.

The helper uses the AWS CLI and Python standard library; no SDK installation or
additional long-lived credentials are needed. Actions `actions: read` lets it
verify the exact CI run attempt identified by the image tag.

## Operate

1. Identify the incident's failing run/deployment. Choose **automatic** to discover
   its recovery image, or **manual** to supply a known-good ECR release tag from
   a **successful Continuous Integration main-push run**. For manual selection,
   GitHub's CI run Summary already prints `Published image: ...:sha-COMMIT-RUN_ID-ATTEMPT`;
   copy only the `sha-...` tag, not the full URI. Preserve the selected digest/evidence.
2. **Pause merges and cancel pending/other forward CI releases before executing
   recovery.** The recovery workflow serializes other recovery requests, but
   deliberately does not queue behind the deployment it needs to stop. Its
   separate concurrency group is not a lock against CI, console users, or future
   merges. Canceling an Actions run does not stop an ECS deployment already
   submitted. Check ECS's actual state afterwards and select the correct mode.
   A later successful main release would replace the restored image.
3. Start an independent timestamped observer **before the fault** when measuring
   the full incident. Save CloudShell observations under its persistent home
   directory, not `/tmp`, and download a copy. The workflow's own observer starts
   after runner startup/preflight; it cannot reconstruct earlier availability.
4. Open **Actions → Rollback ECS → Run workflow**, choose **main**, select the
   mode and **image_selection**. Leave the tag blank for automatic, or paste the
   good pipeline tag for manual. Leave **Execute recovery unchecked** to preview.
   Read the selected image/commit/CI link in the Summary and inspect `plan.json`
   in the artifact for revision/deployment details. A preview changes no deployment.
5. For the authorized recovery, run it with the same inputs and check **Execute
   recovery**. Automatic selection is recalculated for this dispatch; select manual
   with the previewed tag if you need to pin that exact artifact. It resolves the
   tag, checks the successful CI attempt, verifies
   the previous deployed image, and rechecks the plan before submitting a change.
   Do not run a new preview in the timed incident if preparation is already done;
   execution performs the same checks again.
6. Watch UTC events and health observations. `rollback_request_accepted` means
   AWS accepted a request, not that recovery completed. Completion requires the
   expected ECS image/revision and running task state, followed by three valid
   health responses, nonempty news and the CloudFront CORS header. Preserve
   failed samples even when recovery eventually succeeds.
7. Download the `ecs-rollback-<run-ID>-<attempt>` artifact, inspect CloudWatch and
   the affected behavior, and fix the faulty source through a reviewed PR before
   resuming normal releases.

The mode/tag/Execute inputs are passed as quoted arguments through environment
variables, not interpolated into shell code. The helper fails closed on ambiguous
sources, wrong digests/account, failed/unrelated CI runs, overlapping ECS updates,
changed plans and missing history. `restore-image` also requires a successful
historical ECS deployment containing the selected digest. It never prints or
saves the full Express configuration, environment values, or secret references.
Old releases no longer present in ECS deployment history need a separately
reviewed provenance/recovery process; do not bypass that guard during an incident.

For a CLI preview using an already authenticated AWS CLI and GitHub token:

```sh
# Automatic selection: no tag copying.
python3 deployment/rollback_ecs.py --mode ongoing --image-selection automatic \
  --evidence-dir "$HOME/cs4421-evidence/unique-automatic-run"

# Manual selection (also the backwards-compatible CLI default).
python3 deployment/rollback_ecs.py --mode ongoing \
  --image-selection manual --image-tag "$GOOD_RELEASE_TAG" \
  --evidence-dir "$HOME/cs4421-evidence/unique-manual-run"
```

Add `--execute` only for the authorized live recovery. The workflow supplies
`GITHUB_TOKEN`; local use requires a token with Actions read access in the
environment. Never paste or commit the token. Use a new evidence directory for
each invocation.

## Evidence and limitations

Artifacts are retained for 30 days, including on helper failure:

- `plan.json`: selected release, digest and recovery identities; no runtime secrets.
- Actions summary: image-selection method, tag/digest, source and CI-attempt links.
- `events.jsonl`: UTC preflight, request, acceptance, ECS completion and functional
  verification, or the observed failure. `ecs_recovery_observed` records changed
  deployment status and safe revision/task counts; `recovery_superseded` identifies
  a later ECS deployment without logging runtime configuration or secrets.
- `health.jsonl`: HTTP status, validated health result and latency from the runner,
  with a nominal one-second pause between sequential requests (three-second timeout).

The helper waits up to 25 minutes after acceptance and polls ECS every five
seconds. It keeps request timing separate from eventual control-plane completion.
For an ongoing canary rollback, it requires `ROLLBACK_SUCCESSFUL` and the selected
source in `currentServiceRevisions` at the desired running capacity, with no pending
tasks or other requested/running workload. The source revision must still match
the planned task definition and image digest. It repeats the revision and newer-
deployment checks after health/news verification. The top-level service
`taskDefinition` can be absent for this service; it is not used to identify the
running source. See AWS's [current service revision summary](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ServiceCurrentRevisionSummary.html).

AWS rollback success and a failed Actions run can coexist. A rollback request can
succeed before later verification fails, or a new forward release can replace the
recovered revision. A later ECS deployment is reported explicitly rather than
waiting 25 minutes for an image that has been superseded. This detection is not a
lock: continue to pause merges and pending forward releases before recovery.
It does not inject a fault, observe an error alarm, revert Git source, restore
historic runtime configuration in `restore-image` mode, change static S3 content,
or establish an SLO/zero-downtime claim. An ongoing rollback restores the whole
previous service revision; an image restoration preserves today's configuration.
Confirm that it is compatible with the selected image.

Health can remain 200 through a canary because the good revision still receives
traffic. A first 200 alone does not identify the serving image or prove every
request succeeded. Use the exact recovered revision/image and full incident's
observations. No live rollback, failed-probe/alarm drill, or timing target is
established by local tests or a preview.

If execution fails, inspect ECS before trying again: the request may already
have changed production. Artifacts distinguish submission from verification.
Use the ECS console/CLI fallback if GitHub is unavailable; both use the same
underlying AWS operation. To retire this feature, remove its workflow through a
reviewed PR and remove only its supplemental IAM policy after checking usage.

Permissions were mapped using AWS's programmatic
[ECS service reference](https://servicereference.us-east-1.amazonaws.com/v1/ecs/ecs.json)
and [ECR service reference](https://servicereference.us-east-1.amazonaws.com/v1/ecr/ecr.json).
See also [manual workflow execution](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
Automatic discovery uses ECS [service revisions](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeServiceRevisions.html)
and ECR [image metadata](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_DescribeImages.html).
