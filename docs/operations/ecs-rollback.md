# Manual ECS recovery from GitHub

`Rollback ECS` restores an existing tested artifact without an application build,
Docker build, ECR push, or full CI run. The reviewed recovery workflow runs only
from `main`, authenticates through the existing AWS OIDC role, and targets only
`default/astro-blog` in account `873716897321`, region `us-east-1`.

| Mode | Use | Result |
| --- | --- | --- |
| `ongoing` | Exactly one deployment is PENDING or IN_PROGRESS | Ask ECS to roll that deployment back to its previous service revision; require that revision to contain the selected known-good image |
| `restore-image` | Deployment has finished, with no ongoing operation | Start a new Express deployment of the selected digest, preserving the current container configuration except its image |

An ongoing rollback can reuse the previous revision. Restoring an image after a
completed release still needs ECS startup, health checks and traffic shifting.
Runner startup and AWS operations take time: this workflow does not guarantee
sub-minute recovery. [AWS's ongoing-deployment rollback procedure](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/stop-service-deployment.html).

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

1. Identify the incident's failing run/deployment and select a known-good ECR
   release tag from a **successful Continuous Integration main-push run**:
   `sha-<40-character-commit>-<run-ID>-<attempt>`. Preserve its recorded digest
   and evidence. Arbitrary tags such as `latest` and `v1.0.0` are rejected.
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
   mode, paste the good release tag, and leave **Execute recovery unchecked**
   to preview. Inspect `plan.json` in the run's artifact: digest, source SHA,
   run/attempt and recovery revision/deployment. A preview changes no deployment.
5. For the authorized recovery, run it with the same inputs and check **Execute
   recovery**. It re-resolves the tag, checks the successful CI attempt, verifies
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
python3 deployment/rollback_ecs.py --mode ongoing \
  --image-tag "$GOOD_RELEASE_TAG" --evidence-dir "$HOME/cs4421-evidence/unique-run"
```

Add `--execute` only for the authorized live recovery. The workflow supplies
`GITHUB_TOKEN`; local use requires a token with Actions read access in the
environment. Never paste or commit the token. Use a new evidence directory for
each invocation.

## Evidence and limitations

Artifacts are retained for 30 days, including on helper failure:

- `plan.json`: selected release, digest and recovery identities; no runtime secrets.
- `events.jsonl`: UTC preflight, request, acceptance, ECS completion and functional
  verification, or the observed failure.
- `health.jsonl`: HTTP status, validated health result and latency from the runner,
  with a nominal one-second pause between sequential requests (three-second timeout).

The helper waits up to 25 minutes after acceptance and polls ECS every five
seconds. It keeps request timing separate from eventual control-plane completion.
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
