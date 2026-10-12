# News bootstrap follow-up — 12 October 2026

Tracked under [issue #65](https://github.com/Installity/cs4421-astro-blog/issues/65), after the theme fix in [PR #68](https://github.com/Installity/cs4421-astro-blog/pull/68). Branch: `fix/65-news-bootstrap`.

As a reader, I want headlines to load after moving from a project article to Tech News so that navigation works consistently.

Live CloudFront verification in WebKit reproduced About → Blog → Velsat → News staying on “Loading”, with a hidden retry button, no news request, and no page error. Instrumentation showed `astro:page-load` before registration of the compiled inline news module's listener. Manually emitting the event loaded 59 headlines. The API returned HTTP 200 with correct CORS; the failure occurred before fetching.

Initialize news when its module evaluates as well as on subsequent page-load events. A WeakSet guards each section against duplicate requests, intervals and handlers. Existing before-swap cleanup aborts the request, clears the interval and releases the guard. [Astro's lifecycle guide](https://docs.astro.build/en/guides/view-transitions/#astropage-load) describes the navigation events; this fix also handles the observed late evaluation.

Given first entry through an article, headlines and retry appear once. Given a missed first page-load event, eager initialization still loads headlines. When later events repeat, a retry sends one request; leaving and returning initializes the new section once. Tests mock an HTTPS API with CORS to exercise static configuration without real feed dependencies.

The old static build failed the first-entry WebKit case and both deterministic missed-event cases. The fixed static build passes all four Chromium/WebKit cases. CI now runs them against the production static build with a fixture API URL; the actual static deployment workflow still supplies the real ECS API URL.

Local verification: 82 browser cases passed on development and compiled server builds; four production-static lifecycle cases passed; 31 application unit, 8 CDK and 7 deployment tests passed; lint, Astro checks (zero errors/warnings, one existing hint), static/server builds, CDK build and synthesis passed. Independent agent review found no correctness issues. Remote CI/container health and live release results are recorded in the linked PR and issue. Classmate review remains outstanding.

Rollback uses a tested revert PR and the existing main deployment workflows. This follow-up adds no AWS resources or API/cache configuration changes.
