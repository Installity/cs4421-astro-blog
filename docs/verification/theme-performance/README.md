# Theme transition verification — 12 October 2026

Issue: [#65](https://github.com/Installity/cs4421-astro-blog/issues/65). Branch: `fix/65-smooth-theme-transition`.

As a reader, I want a smooth circular theme change from the moon control so that switching colors feels comfortable while browsing.

## Design and measurements

The new native view-transition image is live, so the wave canvas was still redrawing thousands of dots during the circular clip animation. Temporarily suspend that loop at its current phase, paint the new palette once, then resume after snapshot cleanup. This suspension does not overwrite the reader's pause choice. Use a 600 ms ease-in/out reveal instead of the previous 480 ms strongly front-loaded easing.

Six alternating transitions on `/about/`, headless Chromium, 1440 × 1000, 4× CPU throttling:

| Observation | Before (`c9d55d9`) | After |
| --- | --- | --- |
| Wave redraws while reveal marker is active | 12–14 per reveal | 2 per reveal |
| Sampled animation-frame intervals, median / p95 | 16.7 / 16.8 ms | 16.7 / 16.7–16.8 ms |
| Sampled intervals per reveal | 29 | 37–38 |

Raw results: [before.json](before.json), [after.json](after.json). These measurements demonstrate reduced drawing work and longer animation pacing; they do **not** establish a higher display refresh rate or guarantee frame rates on physical devices. The browser already drives the native animation at its display cadence. Clip-path rasterization remains browser-dependent.

Reproduce using installed dependencies and the background dev server:

```sh
npm run dev -- --background
node docs/verification/theme-performance/measure-theme.mjs /tmp/theme-measurement.json
npm run astro -- dev stop
```

Set `TEST_BASE_URL` when using another local port. Use the same viewport, browser and CPU throttle for both versions. The native API behavior is described in [MDN's view-transition guide](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using).

## Acceptance evidence

- Given running waves, when either theme reveal is held, the bitmap stays still in the new palette; after completion it changes again. The new regression **fails against the old wave loop** and passes with the fix.
- Given a saved manual pause, when the theme changes, the background stays paused and storage remains unchanged.
- Given rapid clicks, a skipped native snapshot, navigation during a held reveal, or a reduced-motion change during an active reveal, the latest theme remains usable and suspension is released; reduced motion still prevents animation.
- Keyboard control, CSS fallback, saved themes, default wave motion, portrait loading, project posts, news states/filtering and viewport overflow remain covered.

Local results: lint passed; Astro checks returned zero errors/warnings (one existing Zod deprecation hint); 31 app unit tests, 8 CDK tests and 7 deployment tests passed; the combined 76-case development suite plus two navigation-interruption cases passed; the final 78-case Chromium/WebKit suite passed on the compiled server after integration with main. Static/server builds, CDK TypeScript build and synthesis passed. Desktop/mobile light, dark and midpoint screenshots were reviewed. Linux container health and remote CI are verified in the linked PR before merge; deployment evidence is recorded in the issue after release. Independent agent review found no concrete bugs; classmate review remains outstanding.

Screenshots: [desktop light](light-1440.png), [desktop reveal](reveal-1440.png), [desktop dark](dark-1440.png), [mobile light](light-390.png), [mobile reveal](reveal-390.png), [mobile dark](dark-390.png).

Rollback: revert the fix through a tested PR and let the existing main workflows republish CloudFront assets and the ECS image. This change adds no infrastructure or configuration.
