# Required review and CI gates

Related: [#77](https://github.com/Installity/cs4421-astro-blog/issues/77).
This change proposes configuration for review; committing the JSON does not apply
it to GitHub. No repository setting or protection was changed.

## Verified current gap, 2026-10-22

GitHub's ruleset API returned active repository ruleset `23882004`, named
`Main Branch Protection`, targeting the default branch. It blocks deletion and
non-fast-forward updates and requires PRs. Its approving-review count is **0**,
and it has **no required_status_checks rule**. The bypass list is empty and the
current user cannot bypass. A `protected=true` branch flag therefore does not
prove that human approval or green CI is enforced.

PR #93's actual check runs independently showed GitHub Actions app ID `15368`
reporting `Validate project`, `Build, test, and publish container`, and `test` as
successful. `Deploy and verify ECS site` was skipped, correctly, because PRs do
not publish/deploy. Check names below are observed contexts, not slide examples.

## Proposed change

[`main-ruleset.proposed.json`](../../deployment/main-ruleset.proposed.json)
preserves the existing name, target, enforcement, no-bypass policy, deletion and
force-push protection and allowed merge methods. It changes the approval count
to one, dismisses stale approvals after new reviewable commits, and requires
these actual Actions checks on an up-to-date branch:

- `Validate project`: includes lint, Astro checks, unit/browser/CDK/deployment
  tests, production static verification and synthesis.
- `Build, test, and publish container`: runs image build/health verification on
  PRs; publishing is main-only. A container failure must also block merging.

The separate `test` browser workflow duplicates browser checks in Validate project;
it remains useful feedback but is not an additional required context here.
Do not require the main-only deployment job on PRs, which would prevent normal
merging. Recheck contexts and app ID if workflows are renamed or moved.

## Applying the reviewed configuration

After peer review, an authenticated repository administrator must re-read the
live ruleset and compare it with the snapshot above. If settings have changed,
review the new diff and preserve any additional protection; do not blindly
overwrite concurrent rules. Update the existing ruleset, rather than creating a
second similarly named ruleset. With an appropriately authenticated GitHub CLI:

```sh
gh api repos/Installity/cs4421-astro-blog/rulesets/23882004
# After comparing/reviewing the current state:
gh api --method PUT \
  repos/Installity/cs4421-astro-blog/rulesets/23882004 \
  --input deployment/main-ruleset.proposed.json
```

The current connector can read rulesets but does not provide administration
writes; the local GitHub CLI was unauthenticated at inspection. This PR does not
store a token or add an administration credential to CI. Use the existing owner
settings session or a deliberate authenticated CLI session when applying it.
The [GitHub ruleset API](https://docs.github.com/en/rest/repos/rules) documents
the update schema and Administration write permission.

## Verification before closure

Read the applied rules/effective main rules again and retain sanitized settings
and timestamp. On a harmless feature PR, observe that missing approval blocks
merge; a failing required check must block it too. Once checks pass and a real
classmate approves, observe the allowed state. Do not perform a failing merge to
test a gate or bypass protection for rollback exercises. Record the student's
review/CI evidence and keep #77 open until application and merge-gate behavior
have both been verified.
