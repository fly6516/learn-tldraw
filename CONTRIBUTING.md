# Contributing

Use Bun 1.3.6 and Node.js 24, the versions used by CI.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
bun run build
```

The default unit tests and production build need no model credentials. Install Tectonic and place
its executable on PATH to run the compiler and browser regressions. On first use, Tectonic may
fetch its TeX bundle. Set `TECTONIC_ONLY_CACHED=1` for an already populated cache.

```sh
LATEX_COMPILE_ENABLED=1 bun run test
bunx playwright install chromium firefox
bun run test:e2e
```

In PowerShell, use `$env:LATEX_COMPILE_ENABLED = '1'` before running the unit tests.
The browser runner starts a built local app on port 3177. It uses a synthetic fixture and
a local model that emits deterministic streams, including tool calls. No real model key is needed.
Test ZIPs, backups, traces, and reports belong in the ignored `test-results` folder.

To exercise the same workflows by hand, start a separate loopback server with
`RESEARCH_TEST_MODE=1` and `LATEX_COMPILE_ENABLED=1` and open
`/research-test?view=write`. Use **Download test project ZIP** to start over or test import.
Open **Writing AI** in Auto and send one of the test prompts shown on the page.
The test workspace uses separate browser
storage from the main project. Keep test mode disabled in normal use.

The optional live browser tests require the synthetic **Morning Walk Study** sources and the
server's configured DeepSeek key. They send synthetic chapter excerpts, CSV data and reviewer
comments to the configured model. Set `RESEARCH_LIVE_TEST_ZIP` to a local copy of the source ZIP
or set `RESEARCH_LIVE_TEST_PATH` to a locally seeded demo route including `?view=write`.
Build the app, then run `bun run test:e2e tests/e2e/live-writing.spec.ts`.

Use `.env.example` as a reference for local environment options. Keep real credentials,
private research, and local test outputs out of commits.
