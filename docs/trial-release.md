# Build and run a local trial bundle

To run from source, follow the [README quick start](../README.md#quick-start).
To try the packaged app, follow the included [START HERE instructions](trial-quickstart.txt).
The trial uses local browser storage and the bundled Tectonic compiler. Choose
**Try a writing sample** and **Use example edits** to review changes, build a PDF
and export a submission without a model key. **Practice with review issues**
adds a compiler error and an ambiguous CSV key.

## Package the trial

On the target OS and architecture, install Node.js 24. From a clean checkout,
run `bun install --frozen-lockfile`, then pass a Tectonic executable and its
distribution notice to the packager.

```sh
bun run package:trial "$TECTONIC_BIN" "$TECTONIC_NOTICE_FILE"
```

The command prints the folder created under `build/`. Share the entire folder
with its `START HERE.txt` and runtime notices, subject to the runtime distribution
terms. Recipients can launch the bundle without Bun or a model credential.
Tectonic may download resources for the first compile.

## Verify the bundle

Start the launcher and set `RESEARCH_TRIAL_E2E_URL` to its loopback origin.
With the test dependencies installed, run:

```sh
bun run test:e2e tests/e2e/workbench-setup.spec.ts tests/e2e/writing-sample.spec.ts
```

Set `RESEARCH_TRIAL_PREPARE=1` with an empty `TECTONIC_CACHE_DIR` to verify
initial resource preparation. Check that compiling, reopening the archive, and
restoring a [project backup](project-recovery.md) work from a fresh browser
profile. If testing multiple tabs, compare saved changes before replacing a
stale editor state. For compiler and model test options, see
[Contributing](../CONTRIBUTING.md).
