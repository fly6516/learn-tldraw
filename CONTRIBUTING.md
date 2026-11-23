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

Open **Workbench setup** in the project library or Writing to check browser storage,
the local compiler, and model configuration. The compiler check runs a built-in document
using cached resources. Use the sample's normal **Compile PDF** action to warm the cache.

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
Choose **Practice with review issues** to produce a sample draft with a compiler error.
The exercise walks through the review queue, duplicate CSV keys, a changed calculation,
resuming after refresh, and archiving the repaired manuscript. CI runs the normal browser
suite and runs the sample again with both model credentials explicitly empty.

The optional live browser tests generate the synthetic **Morning Walk Study** ZIP from the
checked-in fixture. Configure `DEEPSEEK_API_KEY` for the loopback test server. The test
sends synthetic chapter excerpts, CSV data and reviewer comments to the configured model.
After building, run `RESEARCH_LIVE_TEST=1 bun run test:e2e tests/e2e/live-writing.spec.ts`.
In PowerShell set `$env:RESEARCH_LIVE_TEST = '1'` before running the command. To use another
local copy of the same fixture, set `RESEARCH_LIVE_TEST_ZIP` to the ZIP path or
`RESEARCH_LIVE_TEST_PATH` to a locally seeded demo route including `?view=write`.

**Review context** previews the files, drafts, CSV and diagnostic material available to
the model in a source request. **Read exclusions** accepts project-relative paths and
folder paths ending in `/`. With exclusions enabled, previous chat text and compiler
reports stay local. A task planned under different exclusions needs a new plan.
Restoring a project snapshot keeps the current read exclusions.
`tests/e2e/ai-read-scope.spec.ts` checks the actual request body and the saved receipt.

`tests/e2e/submission-evidence.spec.ts` checks saved manuscript claims against the selected
manifest and the final ZIP. It excludes a supporting CSV, checks source navigation, and
confirms that the project archive retains the author's exception after a reload.

The optional Biber browser test builds a separate synthetic River Gauge Study. Install
pdfLaTeX, biblatex, Biber, latexmk, and Poppler `pdftotext` in the test environment. Set
`RESEARCH_BIBER_TEST=1` on a system with those commands on PATH, or set
`RESEARCH_BIBER_WSL` to the configured WSL distribution on Windows. Build the app and run
`bun run test:e2e tests/e2e/biber-delivery.spec.ts`. The test compiles the actual downloaded
ZIP, backs up the verified task in Chromium, and imports it in Firefox before archiving.
It compares the archived ZIP and PDF bytes and checks that an edited copy needs a fresh build.

The publisher regression uses the [Springer Nature December 2024 template ZIP](https://www.springernature.com/gp/authors/campaigns/latex-author-support).
Set `RESEARCH_PUBLISHER_ZIP` to the downloaded file and run `bun run test:e2e tests/e2e/publisher-template.spec.ts`.
Keep the template and generated files in an ignored test folder. The regression pins the
publisher ZIP by SHA-256 and builds two ZIPs downloaded from the browser. It needs
pdfLaTeX, BibTeX, latexmk, `epstopdf`, Ghostscript, and Poppler `pdftotext`. On Ubuntu,
install `texlive-latex-extra`, `texlive-science`, and `texlive-font-utils` to supply
`manyfoot.sty`, `algorithm.sty`, and EPS conversion support.
On Windows the test can run the commands in the distribution named by `RESEARCH_BIBER_WSL`.
The build uses a recursive `BSTINPUTS` path for the `bst/` directory and preconverts
the included EPS with `epstopdf` before calling latexmk with shell escape disabled.

Use `.env.example` as a reference for local environment options. Keep real credentials,
private research, and local test outputs out of commits.
