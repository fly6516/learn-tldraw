# Research Canvas 0.1 trial

This candidate covers one complete local manuscript workflow. Start with the
[quick start](../README.md#quick-start), import a multi-file LaTeX ZIP or the built-in
sample, and work between Canvas and Writing. Choose **Practice with review issues**
to try a compiler error, an ambiguous CSV key, and recovery after refreshing.

## Acceptance checklist

- Install the locked dependencies from a clean checkout and build the app. Run the
  sample with model credentials absent and confirm the saved drafts, PDF, and archive.
- In Chromium, export a backup with local drafts and the desired history. Import it
  in Firefox and check Canvas pages and coordinates, attachments, the main entry,
  and the SHA-256 values of archived ZIP and PDF downloads.
- Open the same project in two tabs. Save a change in one, then try a stale source
  save, Canvas edit, AI save, or snapshot restore in the other. Use **Compare saved
  project** to find the difference. Use **Back up this tab** to keep edits that only
  exist there before loading the saved version.
- Prepare an external build ZIP, run the selected engine, and attach its PDF. Check
  that a changed source or ZIP manifest requires a fresh handoff. Biber and Springer
  Nature acceptance commands are listed in [Contributing](../CONTRIBUTING.md).

Projects and drafts are stored by browser and site address. A backup is the transfer
format for a different browser or machine. The optional model runs through the local
server and sends the shared context to the configured provider. For external builds,
the author confirms that the returned PDF came from the displayed source ZIP.

## Build a local trial bundle

On the target OS and architecture, use Node.js 24, run `bun install --frozen-lockfile`
in a clean checkout, then run:

```sh
bun run package:trial /path/to/tectonic /path/to/tectonic-notice
```

The build prints the folder created under `build/`. The bundle includes the Node
and Tectonic executables for that platform and serves the workbench on loopback.
Keep the notices from the original runtime distributions and distribute the whole
folder with **START HERE.txt**. The application runs without Bun, developer tools
or a model key on the recipient's machine. The first compile may fetch LaTeX resources.

For a fresh participant, start the timer at extraction. Ask them to launch the
workbench, start the sample, compile the first PDF and download a recovery backup.
Record OS, browser, time to first PDF, steps requiring help and any compiler error.
Use synthetic data for trial feedback.

To test a running bundle, set `RESEARCH_TRIAL_E2E_URL` to its loopback origin and run
`bun run test:e2e tests/e2e/workbench-setup.spec.ts tests/e2e/writing-sample.spec.ts`.
