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

On the project list, **Try a writing sample** imports Practice Paper and opens Writing AI.
**Use example edits** runs the scripted sample without a model key. The usual draft, save,
compile and archive approvals still apply. It needs the local LaTeX compiler. For browser
acceptance outside simulated server mode, set `RESEARCH_SAMPLE_NO_KEY=1` and run
`bun run test:e2e tests/e2e/writing-sample.spec.ts`. To exercise **Use configured model**,
set `RESEARCH_LIVE_TEST=1` with a configured DeepSeek key and run the same file.

The optional live browser tests generate the synthetic **Morning Walk Study** ZIP from the
checked-in fixture. Configure `DEEPSEEK_API_KEY` for the loopback test server. The test
sends synthetic chapter excerpts, CSV data and reviewer comments to the configured model.
After building, run `RESEARCH_LIVE_TEST=1 bun run test:e2e tests/e2e/live-writing.spec.ts`.
In PowerShell set `$env:RESEARCH_LIVE_TEST = '1'` before running the command. To use another
local copy of the same fixture, set `RESEARCH_LIVE_TEST_ZIP` to the ZIP path or
`RESEARCH_LIVE_TEST_PATH` to a locally seeded demo route including `?view=write`.

The optional Biber browser test builds a separate synthetic River Gauge Study. Install
pdfLaTeX, biblatex, Biber, latexmk, and Poppler `pdftotext` in the test environment. Set
`RESEARCH_BIBER_TEST=1` on a system with those commands on PATH, or set
`RESEARCH_BIBER_WSL` to the configured WSL distribution on Windows. Build the app and run
`bun run test:e2e tests/e2e/biber-delivery.spec.ts`. The test compiles the actual downloaded
ZIP, backs up the verified task in Chromium, and imports it in Firefox before archiving.
It compares the archived ZIP and PDF bytes and checks that an edited copy needs a fresh build.

Use `.env.example` as a reference for local environment options. Keep real credentials,
private research, and local test outputs out of commits.
