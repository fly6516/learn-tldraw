# Project compile settings

In Writing, select the engine label next to **Compile PDF** to choose a main
file, engine and bibliography backend. The settings belong to the project and
travel with a recovery backup. Changing them makes the previous preview and AI
verification stale. The compiler uses the same settings for a Writing preview,
verification of the selected AI changes, and the exact submission ZIP.

Tectonic is the default and is included in the trial package. For trusted
projects, an installation with TeX Live on PATH can also run **pdfLaTeX** or
**XeLaTeX**. Enable this in the loopback server environment and restart it.

```dotenv
LATEX_SYSTEM_TEX_ENABLED=1
# Optional on Windows. Set this to your installed WSL distribution name.
LATEX_SYSTEM_TEX_WSL=Ubuntu-24.04
```

Install BibTeX or Biber in that same TeX installation if the project requires
it. Automatic mode checks the bibliography files emitted by the first TeX pass.
Biber uses project-relative bibliography files included in the ZIP. Shell
escape is disabled for local engine runs. LuaLaTeX and templates that need
custom build scripts or packages unavailable locally use the existing external
build ZIP and PDF attachment. The archive keeps the exact ZIP and attaches the
selected profile or the engine used for an external build.

For the end-to-end check, set `RESEARCH_SYSTEM_TEX_E2E=1` alongside the local TeX
settings and run `bun run test:e2e tests/e2e/compile-profile.spec.ts`. It uses
Poppler's `pdftotext` to verify the bibliography in the PDF. For the Windows WSL
run, set `RESEARCH_BIBER_WSL` to the same distribution for the test's PDF check.
