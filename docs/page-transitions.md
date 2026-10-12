# Smooth page transitions

Feature: [issue #66](https://github.com/Installity/cs4421-astro-blog/issues/66).
Branch: `feat/66-smooth-page-transitions`, based on `main`.
Validated on 12 October 2026.

## Requirements and acceptance

Clicking Home, Blog, Tech News or About should smoothly change the content
without restarting the shared background or controls. Article links use the
same behavior. Navigation must remain accessible and preserve browser history.

| Requirement | Browser coverage in `tests/page-transitions.spec.ts` |
| --- | --- |
| Smooth internal navigation, stable background | Same document and canvas identity across all four sections; actual native fade duration |
| Correct active link, title and canonical URL | Section navigation and Back/Forward assertions |
| Theme and manual pause survive navigation | Repeat section/article visits, then change theme and resume motion |
| Search and topic filters work on return | Search and topic filtering on two separate Blog visits |
| News works on return without duplicate handlers | Two visits, publisher filtering, exactly one request per refresh |
| Accessibility and compatibility | Reduced-motion animation suppression, keyboard navigation without the native API, JavaScript-disabled navigation |

Existing theme, news, article, asset and responsive browser tests also remain
part of the regression suite.

## Design and implementation

The shared `SiteLayout` includes Astro's `ClientRouter` and names the root
transition explicitly. Only `main` fades, using Astro's built-in 180ms fade;
the surrounding layout does not animate. Astro supplies history handling,
route announcements, reduced-motion support and the animated browser fallback.
See [Astro's view transition guide](https://docs.astro.build/en/guides/view-transitions/).

The canvas wrapper and the two control buttons persist across navigation,
retaining their DOM nodes, event listeners and animation state. The current
theme is copied to the incoming document before swap, without relying on
storage. Starting navigation cancels any active circular theme reveal.
Theme-only snapshot styling is scoped to the reveal, and temporarily removes
separate transition names so the reveal covers the whole page.

Page-specific search and news initialization runs on `astro:page-load` because
bundled scripts execute once with client routing. Before a page swap, news
aborts pending requests, removes listeners and clears its refresh timer.
There are no new packages, database changes or configuration migrations.

## Verification and review

The feature was also tested in an isolated source snapshot excluding unrelated
theme animation edits being made concurrently in another chat.

- `npm run lint`: passed.
- `npm run check`: zero errors and warnings; one existing content-schema
  deprecation hint in the isolated snapshot.
- `npm run test:unit`: all 31 tests passed.
- Full Playwright suite: all 68 Chromium/WebKit tests passed, including 14 new
  navigation cases and existing desktop/mobile viewport checks.
- `npm run test:cdk`: all 8 existing infrastructure tests passed.
- Deployment Python unit tests: all 7 existing tests passed.
- `npm run build`: static build passed.
- `ASTRO_OUTPUT=server npm run build`: server build passed.
- `git diff --check`: passed; code review checked script lifecycle, request
  cleanup, transition naming and interaction with the theme reveal.
- `git merge-tree --write-tree HEAD origin/main`: conflict-free against main
  at `c9d55d9`; recheck if main advances.

Live publisher availability and AWS deployments are not acceptance gates for
this navigation change. Browser tests use deterministic news responses.
GitHub CI additionally validates the PR and builds/tests its container.

## Release and rollback

Commits reference #66 and the PR targets main with `Closes #66`, linking the
ticket to the implementation and closing it when merged. Require passing PR
checks and reviewer approval before merging. The existing main workflows
deploy the static site and server container after merge.

After release, smoke-check all four navigation links, an article, Back/Forward,
theme/pause controls, search and news refresh; check the browser console for
errors. Revert the feature PR's commits to restore full-page navigation if a
regression is found. Future page scripts must use the router lifecycle and
clean up document listeners and timers when their page is removed.
