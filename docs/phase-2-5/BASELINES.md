# Phase 2.5 baseline contract

Checkpoint B establishes comparison evidence; it does not approve a route based on a subjective score. Objective visual, accessibility, responsive, performance, request-count, regression, build, and production-health gates remain authoritative.

## Scope

The active baseline contains 15 stock, trading, internal/operator, account, legal, and support routes. Shelved crypto routes are explicitly excluded. Surface density is recorded per route so later work can create a consistent family resemblance without forcing trading, operator, account, legal, and support pages into one density.

The five required viewport captures and route matrix are machine-readable in `visual-baseline.json`. The 75 local PNGs and their generated SHA-256 manifest live under `.artifacts/phase25-baseline` and are intentionally git-ignored. Recreate them against a running local build with:

```sh
HT_BASELINE_URL=http://localhost:3000 npm run baseline:phase25
```

`FIREFOX_BIN`, `HT_BASELINE_OUTPUT`, `HT_BASELINE_VIEWPORTS`, and `HT_BASELINE_ROUTES` may be used to select a browser, output directory, or bounded subset. Every browser process has a 30-second timeout.

## Request counts

Development-only instrumentation is enabled with `?htBaseline=requests`. It adds no requests and publishes one live JSON snapshot containing the route, viewport, horizontal overflow, first-five-second API requests, and all observed API requests. Production builds do not render the probe.

The first measured signed-out desktop window is stored in `request-baseline.json`. Counts are raw development-browser observations, including React development-mode duplicate effects. They are regression evidence, not production traffic projections and not permission to increase requests. Checkpoints C–E must compare the same route, authentication state, viewport, and observation window before accepting any request-count change.

## Comparison rules

- Keep horizontal overflow at zero for every supported viewport.
- Treat changed market values and timestamps as dynamic content, not automatic visual regressions.
- Treat changed chart dimensions, missing controls, clipped content, focus loss, dialog/sheet failures, unexpected API requests, or altered polling as regressions.
- Keep screenshots and request measurements isolated from shelved crypto routes.
- Do not update a baseline merely to make a failing comparison pass; document and approve the behavior change first.
