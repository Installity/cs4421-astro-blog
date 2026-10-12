# Reusable prompts

These prompts request drafts. Replace bracketed context only when it is known. They do not authorize Git or GitHub mutations.

## Combined commit and PR drafting prompt

```text
Use $cs4421-devops for this Astro course project. Read AGENTS.md and the skill's messaging guidance, then inspect the actual changes.

Draft:
1. A Conventional Commit message using type(optional-scope): short imperative description, with an optional body explaining why. Base it on the staged diff; if nothing is staged, clearly label it as a proposal based on the working diff. Suggest separate commits for unrelated changes.
2. A concise PR title and Markdown body based on the complete branch diff against the verified target branch. Use Description, Changes, Closes, and Validation. Describe the problem, resulting behavior, and relevant user story or acceptance criteria. Add risks and rollback only when relevant.

Use only verified issue numbers. If there is no linked issue, say so. Report only checks actually run and observed results; identify unverified checks, CI status, and peer review honestly. Distinguish course requirements from local recommendations. Do not commit, push, publish a PR, merge, or deploy; return the drafts for me to review.
```

If the branch has no distinct commits yet, explicitly say that the PR body is a proposal from the working changes. If the target branch is unclear, inspect repository configuration or ask for it instead of comparing arbitrary branches.

## Commit-only prompt

```text
Use $cs4421-devops to inspect my staged diff and draft a Conventional Commit message. Use an appropriate type and optional scope, a short imperative subject, and an optional body explaining the motivation. If nothing is staged, label the message as a proposal from the working diff. Suggest splitting unrelated changes. Return the message without committing or pushing.
```

## PR-only prompt

```text
Use $cs4421-devops to inspect this branch's full diff against the verified PR target and draft a concise PR title and body. Use Description, Changes, Closes, and Validation; include risks and rollback when relevant. Link only real issues, explain the user-facing result, and report actual verification and outstanding peer review or CI. Return the drafts without publishing or merging.
```

## Course progress prompt

```text
Use $cs4421-devops and its course-requirements reference to compare this repository's evidence with the supplied DevOps milestones. Report each relevant item as verified, implemented but unverified, missing, or needing instructor clarification. Cite files, real PRs, check runs, and live evidence where available. Keep the App Runner requirement distinct from the repository's ECS implementation. Explain the highest-priority gaps and the concepts I should be able to defend. Do not infer completion from filenames or perform cloud mutations or chaos drills.
```
