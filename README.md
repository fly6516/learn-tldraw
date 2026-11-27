# Research Canvas

Research Canvas is a local workbench for mapping a paper, editing multi-file LaTeX,
reviewing changes, and preparing a submission.

## Quick start

Use Node.js 24 and Bun 1.3.6, the versions used by CI.

```sh
bun install --frozen-lockfile
bun run dev --hostname 127.0.0.1
```

Open [Research projects](http://127.0.0.1:3000/research). Import a LaTeX ZIP, or choose
**Try a writing sample** to start with a small synthetic manuscript. **Workbench setup**
shows the state of browser storage, Tectonic, and the configured model. To compile the
sample, install Tectonic, set `LATEX_COMPILE_ENABLED=1` in `.env.local`, and restart.
The sample's **Use example edits** runs without a model key.

For a packaged local trial, see [Build and run a local trial bundle](docs/trial-release.md).
For development and verification, see [Contributing](CONTRIBUTING.md).

## User guides

- [Compile settings and engines](docs/compile-profiles.md)
- [Template support and verification](docs/official-template-acceptance.md)
- [Recover or transfer a project](docs/project-recovery.md)
- [Maintain references across files](docs/reference-maintenance.md)
- [Export a revision package](docs/revision-package.md)
- [Writing AI quality tests](docs/ai-quality.md)

## Workflows

- `/research` lists projects stored in the current browser. Create a project, import a LaTeX
  ZIP or Research Canvas backup, or open an existing project. Project links identify one
  project and its view. Search by project name within **Projects**, **Archived**, or
  **Trash**. Sort by most recently opened or by name. Use **Continue writing** or
  **Open recent canvas** to resume the last opened project.
- `/research-dev` uses the same views with a sample paper.

The project list keeps an existing single project with its original drafts and history. Each
import creates an independent copy, including repeated imports of the same backup. From an
open project, use **Back to projects** to switch without losing local drafts. Archive inactive
projects or move them to Trash from the selected project's **Details** panel.
On small screens, select a row to show its details. **Restore** returns a project
to the active list. **Delete permanently** appears in Trash and requires confirmation.
Open project lists in other tabs refresh when projects are added, updated or removed.
**Download recovery backup** in Details works from Projects, Archived, and Trash.
It includes the saved files and Canvas, persisted local drafts, submissions, revisions,
and snapshots. Use **Project Backup** inside the editor to include optional AI history.
Press `/` to focus search, use the arrow keys to move through project rows, and
press `Enter` to open an active project. `F2` renames the focused project and
`Delete` moves it to Trash.

Use **New project** to choose a starting point. **English article** compiles with
Tectonic. **Chinese research article** uses `ctexart`, the Fandol fonts, and XeLaTeX
with BibTeX. Enable local TeX Live with `LATEX_SYSTEM_TEX_ENABLED=1` to compile it
in Writing, or use the existing external build ZIP. Both starters include editable
sections and an example bibliography. Edit the title and author in `main.tex`.
Choose **Blank canvas** to begin by mapping ideas.

Open **Paper templates** in the project sidebar. Choose **使用模板** to start a
project from Word, LaTeX, or a built-in starter. Reference entries open publisher
resources. The [template support guide](docs/official-template-acceptance.md) lists
registered versions, applicable submission stages, verified features and limits.

### Import Word to TeX

With LibreOffice and Pandoc available on the local server, set `WORD_IMPORT_ENABLED=1`.
Use `LIBREOFFICE_BIN` and `PANDOC_BIN` if they are outside the server's PATH.
Start from **Import Word** in the project list, or **使用模板** on the Shanghai
Electric Power undergraduate card. The school-specific route uses the verified
official attachment bundle and offers manual upload if fetching it fails. Supply
your own `.doc` or `.docx` manuscript and the required cover fields. The
import preserves the official front matter and converts your manuscript to editable
LaTeX. Word drawings and embedded equations can become images. Review the import
report for captions the converter could not match. The running title and layout
are editable in `suep-layout.tex`.

To build a layout for another school, open **Paper templates → My templates → 从 Word 生成模板**.
Upload a Word sample and optionally a guide in PDF, Word, or UTF-8 text. Text-based PDF
guides retain physical page numbers and excerpts for recognized rules. The workbench reads
Word layout properties locally. AI assistance is optional and sends selected headings and
formatting excerpts to the configured provider. Review the sources, resolve conflicts,
then compile the preview and save the layout. With only a Word sample, the saved template
is marked as a reference layout. Reusing it starts a project from the new manuscript and
the selected cover or logo, if any.

Saved Word layouts can be reviewed, edited into a new version, or exported and restored
through the same template ZIP import entry. Open **版式核对** in the project PDF pane
to check the project's saved rules and locate import or compiler issues. For multi-part
theses, select the front matter page numbering, chapter breaks and running header mode.
After renumbering, the importer updates plain-text figure and table references with one
identifiable target. Review ambiguous references and citations in the PDF pane.

After compiling, open **提交前版式检查** in the PDF pane or **Prepare submission**.
Reports link to the compiled PDF and its source snapshot. They show recognized
rules, observed values and any checks that need author review. For official
versions, candidate publication, and editable DOCX export, see
[Template support and verification](docs/official-template-acceptance.md).

For Word layout projects, enable `LATEX_COMPILE_ENABLED=1` and
`LATEX_SYSTEM_TEX_ENABLED=1` with local XeLaTeX. Install the TeX Live CTeX and
Fandol packages along with the dependencies for the selected template. For
official Word front matter, use the required fonts or review the result with
the substitutes available to LibreOffice.

To keep a reusable layout, choose **Import as template** for a LaTeX ZIP or
**Project menu → Save as template** for a project. Select the entry, compiler and
files. **My templates** lets you find, rename, download, reuse and delete layouts.
Each new project receives an independent copy.

Use **Add node** to create a card. **Select** moves nodes and box-selects them, **Pan** moves
the viewport, and **Connect** links two cards in click order or by dragging from an outgoing
handle. The toolbar offers **Undo**, **Redo**, **Delete selection**, and **Fit View**.
In the Canvas page list, the trash button deletes a page and its cards after confirmation.
Undo restores the page and its connections. Canvas keeps at least one page.
Undo and redo apply to edits on the current canvas page, including moves, node edits, and
connections. Use Ctrl/Cmd+Z or Ctrl/Cmd+Shift+Z when the canvas has focus. **Add Page** creates
another graph in the project. Canvas exports use the selected page and its directed connections.

Use **Project search** from the project menu or Canvas toolbar to find cards, Writing source,
or bibliography entries. Source results include local drafts. Linked results offer a direct
jump to the other view when the match overlaps a linked source target.

Use **Project menu → Project Backup** to move the project or protect local drafts.
See the [recovery guide](docs/project-recovery.md) for the backup options, how to
restore official template attachments and archived submissions, and what to do
after a local write fails.

## Edit and compile an existing LaTeX project

Install [Tectonic](https://tectonic-typesetting.github.io/book/latest/installation/) and put it on
PATH, or set `TECTONIC_BIN` to its absolute executable path. Set `LATEX_COMPILE_ENABLED=1` for
the local Next.js process and bind it to loopback with `bun run dev --hostname 127.0.0.1`.
Keep the native compiler on a local server and use it for projects you trust. Tectonic may fetch
packages and fonts on the first compile. Set `TECTONIC_CACHE_DIR` to override the cache directory.
Set `TECTONIC_ONLY_CACHED=1` to compile offline once the required files are cached.

1. Choose **Project menu → Import LaTeX → Import Project ZIP**. A Prism or ordinary LaTeX ZIP
   keeps its paths, original source bytes, and attachments. It opens in **Writing** at the main file.
2. Select a chapter or bibliography in **Files**. To change the compile entry, use **Set as
   main file** from a `.tex` file's menu. The current entry is shown next to **Compile PDF**.
   Monaco retains each file's draft, cursor and scroll position as you switch files and views.
   Drafts auto-save in this browser. Reopening the project restores drafts, the last file and
   its cursor position. Use **Save** or Ctrl/Cmd+S to save drafts to the project, or **Discard
   drafts** to remove the local edits. If the saved file changed, compare its current source
   with the draft before proceeding. Generated `main.tex` is read-only.
3. Choose **Compile PDF** to preview the project with all current drafts. Use **Save** or
   **Ctrl/Cmd+S** to write those drafts to the project. **PDF Preview** keeps the last
   successful build if compilation fails. Citation issues and compiler warnings or errors
   with source locations are underlined in the editor. Select an entry in
   **Problems** to jump to its file and line, or expand **Compiler log** for more detail.
   On desktop, **Problems**, **References**, and **Chapter AI** open below the editor and PDF.
   On narrow screens, use **Source**, **PDF**, and the **Files** drawer. **Project menu →
   Export LaTeX ZIP** downloads the saved source tree.

For imported source projects, select an editable `.tex` file in **Files** and choose
**New chapter** to create a child file and insert its `\input` in the selected source.
Choose **Rename or move…** from a file's menu to change its project-relative path.
Review the affected LaTeX paths, local drafts, and Canvas or review links before applying.
The preview identifies dynamic paths that need a manual check. **Undo file changes**
restores the latest file operation, including its draft and link changes, while the
Writing workspace remains open and before any further edits to files, drafts, or cards.

Open **Cross-references** in Writing to search LaTeX labels by key, heading, caption, or
file. Open a definition or use to locate it in the editor, or insert a `\ref` or `\pageref`
at the cursor. **Problems** lists undefined reference keys and duplicate `\label` definitions
from statically included sources and their drafts.

Choose **Prepare submission** to select saved source or include local drafts. Open **ZIP files**
to review the package and exclude files, leaving the main file included. **Preflight** checks
literal dependencies, citations, and LaTeX labels against the resulting package. Select a finding
to locate it in Writing. Dynamic paths need manual review. The compiler uses the same ZIP offered
for download, and the report shows any compiler diagnostics.

After a successful compile, enter a name and choose **Save submission version**. **Archived
submissions** lets you download the original PDF and ZIP after reopening the project, even after
editing the manuscript. The archive and its file list and findings live in the current browser.

After compiling, place the cursor on a LaTeX line and choose **Show in PDF** to highlight
its typeset location. Click typeset content in **PDF Preview** to open its source file
and line. When a source line has no typeset output, the forward jump uses the nearest
mapped line in the same file. Compile again after editing to refresh both directions.

The compile endpoint accepts ZIPs up to 32 MB, including after extraction. The standard compiler
supports XeLaTeX and BibTeX workflows. Documents that require a different engine, Biber, or
packages unavailable to Tectonic can use **Prepare submission → External compilation**.
Prepare the final ZIP after setting exclusions. The handoff shows the main file, engine and
bibliography hints, a `latexmk` command, and the ZIP SHA-256. Build in your own TeX installation,
then attach the resulting PDF and confirm its source. Saved versions identify externally built
PDFs and retain the original ZIP. The canvas preview and print workflow are also
available in **Canvas** and the project menu.

For example, the [Springer Nature December 2024 journal template](https://www.springernature.com/in/authors/campaigns/latex-author-support)
uses pdfLaTeX, BibTeX, an EPS image and a `bst/` folder. From the extracted main-file directory,
set `BSTINPUTS` as shown in the handoff, convert `fig.eps` with
`epstopdf --outfile=fig-eps-converted-to.pdf fig.eps`, then build `sn-article.tex` with pdfLaTeX.
In a minimal TeX Live installation, add `ncctools` if `manyfoot.sty` is missing. The official
template ZIP includes a sample PDF and manual that can be excluded from the handoff.

## Project snapshots

Open **Project menu → Project Snapshots** to name a version of the saved source files,
Canvas pages and attachments. **Review restore** shows which files, pages and project
settings would change. Use **Compare** to inspect one file, then check the files you want
to restore. **Restore selected files** preserves the other saved files, their local drafts,
and the current Canvas. Resolve any local drafts for the selected files first. Full snapshot
restore requires resolving all drafts. Each restore keeps a recovery snapshot. Snapshots
live in this browser. Use **Project Backup** to move a saved project between browsers.

## Revision rounds

In **Prepare submission → Archived submissions**, open a saved version and choose **Start
revision**. Name the round and add a reviewer comment at a source file or heading, or link an
existing Canvas review card. Reopen the round from **Revision rounds** in Writing. Source links
use the current manuscript, and a linked card can also be located on Canvas.

**Compare files** reads the original archived ZIP and compares it with current project files,
including applicable local drafts. It lists added, removed, modified, and unchanged files and
opens a side-by-side diff for text. A file excluded from the original ZIP has no archived copy.
Revision rounds and their submission archives are stored in the current browser.

Use the [revision package guide](docs/revision-package.md) to import a review
letter, verify replies against archived edits, and export a package. The guide
also covers the AGU same-round clean manuscript, marked manuscript and reply PDF.

## Whole-paper Canvas and LaTeX blocks

Open **Whole paper** to edit all Canvas pages together, or choose **Single page** to focus
on one page. Select a page in the Explorer or in the whole-paper canvas to open it.
In the whole-paper canvas, drag a card or selected group into another page region to move it.
Cross-page connections remain visible there and appear as links in the single-page node inspector.
**Auto arrange** previews alignment and continuation pages for pages above 12 cards.
Undo reverses a move or an arrangement in one step.

Use **Explorer → Project Files** to add an existing image to Canvas. In Writing, **Outline →
LaTeX blocks** lists figures, tables, formulas and formula groups, algorithms, listings,
theorems, proofs and environments declared in the project. Select a destination page and
add a card, or locate an existing card. Formula cards preview supported LaTeX math.
Use **Appendix headings only** to focus the outline on supplemental sections.
In Writing, open **References** to add a unique bibliography entry to any Canvas page.
The card links to the current bibliography entry, and its properties list the source citations.
In Canvas, **Explorer → Project Files** adds datasets and attachments. Those cards link to
the project path and can download the original file. **Add node** includes questions, hypotheses,
evidence, notes, review comments, to-dos and custom cards. Method and Conclusion use the existing
section types. Research cards stay on the Canvas when generating the paper's LaTeX.
Linked graphics support literal `\includegraphics` or `\XeTeXpicfile` paths. A unique `\label`
preserves the link when a caption changes. A table card shows the caption, label and source link.
Generated LaTeX includes the section cards in the entire project in document order. Repositioning
or repaging the cards preserves that order. Images and tables stay attached to the project.

## Writing AI

Set `DEEPSEEK_API_KEY` on the local Next.js server to use the official DeepSeek API.
`DEEPSEEK_MODEL` defaults to `deepseek-flash`. To use OpenAI instead, set `OPENAI_API_KEY`
and `OPENAI_MODEL`. `OPENAI_BASE_URL` optionally points to a compatible Responses server.
Keep the key on the server and run the workbench on loopback.
In **Workbench setup**, choose **Test model connection** to check streaming and tool
calls with a synthetic request. The check shares no project content.

Open **Writing AI** from the project bar. Use **Dock panel** to place it beside the editor and
PDF, then drag the separator to set its width. Use **Float panel** to overlay the right side.
Switching layouts keeps the conversation and restores the last docked width. Use
`/layout docked`, `/layout floating`, or `/layout auto` in the composer to set or reset the
project's local placement preference. These commands work without a model.

The assistant streams its replies and tool activity. **Auto** lets it choose tools from your
request. For example, ask it to revise two chapters together or compile the current preview.
Chapter, Across files and Compiler problems are available for focused tasks. Open **Source
evidence** to jump to the file and line. The preview compiler runs after approval and returns
its report in the conversation. Follow-up messages carry the latest report when available.
Conversations are stored per project in this browser. The model receives recent conversation
text, bounded project sources, and the evidence returned by its tools.

In a long LaTeX file, select lines in the source editor or name a heading, label or
quoted passage in the chat. Choose a match if several passages qualify. **Review context**
shows which line ranges are shared. Review or verify the resulting edits against the
complete project. If a model request stops, **Retry request** resumes the same action
in the current conversation. After a reload, use the existing task card to continue.

Writing AI also recognizes a small set of English and Chinese research terms such as
sampling bias and missing data. To read later CSV records, include the path and rows
in your prompt, for example `Read rows 1902 through 1903 of data/sessions.csv`. Review
the physical lines before sending. For an attachment, use **Share a PDF page or image**.
Choose one page with selectable text, or one PNG or JPEG up to 650 KB, then review the
context. Scanned PDFs require an image or selectable text. Treat image descriptions and
causal or ambiguous numeric claims as material for author review.

In **Auto**, the assistant can propose changes across up to six available editable LaTeX
files per turn. **Scope** can narrow the candidate files. Inspect **View diff**, select the
changes to keep, then choose **Apply to drafts**. The editor shows the changes immediately
and keeps the drafts in this browser. The card can review applied diffs, verify the current
working snapshot, and save the affected sources separately.
The project checks the saved source and local draft before applying or saving. **Undo AI changes**
restores the original source and draft for the affected files while protecting later edits.

Choose **Verify selected changes** to compile a temporary snapshot of the working sources
with only the checked edits applied. Review the result and jump from a diagnostic to the
corresponding line in Writing. Verification keeps your source files, drafts, and last PDF
intact. Changes to the source, compile entry, or selection make the result out of date.

**Save if verification passes** authorizes that proposal and selection to save after a
fresh passing build. A failed or outdated build leaves the project untouched. Unrelated
local drafts can take part in verification and stay local afterward. After verifying a
pending proposal, **Save verified changes** reuses the result while the sources, compile
entry and selection still match. The submission workflow compiles its final ZIP separately.
After **Apply to drafts**, use **Verify working drafts** before saving from the proposal card.
Changing the working sources after verification requires another build.

Writing AI can ask for draft-edit permission with a list of files and a reason. **Approve and
continue** grants access to those files and resumes the request. **Deny request** leaves the
work in review-first mode when no other access was granted. In **Approval mode**, choose
**Auto draft** for the selected scope or **Full draft access** for all editable LaTeX
drafts in the current project. **Revoke access** stops future automatic writes and keeps
drafts already applied. Grants end on a scope change, when leaving Writing or changing
conversations, or on reload. Saving to project sources and archiving require confirmation.

From failed verification, **Use diagnostics in chat** sends the compiler report and the exact
selected replacements back to the assistant for a new proposal. The new proposal has its own
approval.

**Repair and reverify** uses that same report and compiles the replacement automatically. If an
active draft grant covers every replacement, a passing result can apply to working drafts.
Compiler setup and missing-resource failures leave the patch available for retry.

For larger edits, enter the goal and choose **Plan writing task**. Review the file list, then
choose **Continue task**. The task processes files in batches of up to three, pausing for review
when local draft permissions do not cover the proposal. The goal, author decisions, open
questions, batch history, and remaining files survive reload independently of recent messages.
Use **Undo latest batch** or **Undo task batches**. The undo checks for intervening edits before
restoring any files. Reloading pauses the task and expires any automatic draft permission.

When the drafts are ready, choose **Review and save task**, ask Writing AI to review the
manuscript task, or send `/review`. The review compares saved source, task edits, and any
existing author draft. Files containing an existing author draft are initially left unselected.
If the current file has changed since a batch, compare the author version with the last task
version and explicitly include it or leave the file out.

**Verify manuscript** compiles the exact project that **Save verified files** will write.
Unselected files use their saved project source, and their local drafts remain available.
A changed source, compile entry, attachment, draft, or selection invalidates the current
verification. From a failed verification, jump to a source diagnostic or choose
**Repair affected files with AI**. Review the repair as a new draft and verify the manuscript
again. **Undo manuscript save** restores the previous project sources and their pre-save drafts
as one operation, with the same protection against later edits as batch undo.

Writing AI can list attachment paths and cite line-linked CSV records from the current project.
CSV reads are bounded to the available prefix and a requested row range. Figure filenames can
be checked against the project inventory.

To start an end-to-end task, send a request such as “Read `data/sessions.csv`, revise
`sections/methods.tex` and `sections/results.tex`, compile, and prepare a submission.” The
task card shows planned CSV ranges and author questions. Continue after resolving questions
and reviewing the plan. Approving a batch resumes the remaining files, and the last batch
opens manuscript verification. After a refresh, review any pending batch or continue the
remaining files. Automatic draft permissions expire on refresh.

The proposal and manuscript review link exact new wording to the CSV rows, table excerpts,
or bibliography entries the application could locate. Confirm a claim, request fresh read-only
evidence, or exclude its linked change from the draft. The task remembers decisions. Changes to
the wording or linked evidence reopen that claim. A bibliography link locates an entry for the
author to check.

A workflow reuses the verified PDF only when its source ZIP exactly matches the submission
manifest. Confirm the archive in the submission card. A task keeps the same archive ID after
refresh. For Biber and templates that specify pdfLaTeX or LuaLaTeX, use the external build
ZIP in task review and attach the corresponding PDF before saving. The local browser retains
the verified PDF until archiving. Include **AI conversations and task history** in a project
backup to carry that PDF and the claim decisions to another browser. Include local drafts
to continue work before project save. The restored task checks the main file and exact ZIP
checksum before offering the PDF for archiving.

Ask for submission preflight or use `/submission Submission v1`. Review file exclusions
and the local-draft setting in the chat card before compiling the exact ZIP. The compiled
PDF and ZIP can be downloaded and explicitly archived from the card. Templates that need
an external engine can use the handoff in Prepare submission.

Ask to create a named revision round from an archived submission or to add a reviewer
comment for a specific source file. Both cards require confirmation, and ambiguous archive
or round names must be resolved first. You can also use `/newround Round 1 | Submission v1`
and `/comment sections/results.tex | Clarify the results. | Round 1`.
Use `/revisions` to see reviewer comment numbers, then
`/reply 1 | Round 1 | Submission v2` to draft a reply grounded in the archived ZIP differences.
Omit the names when a unique round and linked archive are available. Review the reply and
confirm saving it in chat. Use `/letter` or `/letter Round 1` to preview and download the
Markdown response letter.

Each proposal has an **AI task record**. Expand **Task activity** to see its approvals,
verification attempts, saves, and undo actions after reloading. Repair proposals link to
the original proposal and compiler result. Source evidence follows
tracked Writing file moves and uniquely identifiable lines. When it cannot be located
reliably, **Find fresh evidence** prepares a follow-up request in the same conversation.

Choose **Reviewer reply** to open Revision rounds. Select a revised submission and the files
that support the response before choosing **Draft response with AI**. This workflow reads bounded
excerpts from the archived ZIPs. **Use AI draft** copies the streamed proposal into the response
editor for review before saving.
## References

See [Maintain references across files](docs/reference-maintenance.md) for bibliography
merges and safe renames of citation keys and labels.

Open **References** in the LaTeX editor to search project `.bib` entries by key, title,
author, or year. **Insert** adds `\cite{key}` at the source editor's caret or replaces its
current selection. Citation issues list missing keys in project `.tex` files and each
definition of a duplicate key. Click an issue to select the key in its source file.
The check uses all project bibliographies and includes unsaved drafts. AI
suggestions flag new citation keys that have no matching project bibliography entry.

Open **Search** beside **Files** and **Outline** to find literal text across project
`.tex` and `.bib` files, including local drafts shown in the editor. Select a result
to open its file and select the matching text.

Open **Outline** to browse headings from the selected main file and its statically linked
`\input` and `\include` files. The outline follows document order and nests subheadings under
their parents. Click any title to select it in the source editor. Unsaved title edits update
the outline as you type.

For imported ZIP projects, use a heading's **Canvas actions** to add a node to any
page or bind an existing node. **Locate on Canvas** selects the linked node, and
**Open source** in its properties selects the heading in Writing. A unique `\label`
immediately after the heading keeps the link working when the title changes. For an
unlabeled heading, changing its title or making it ambiguous requires binding it again.

Use **Project menu → Source link check** to find missing or conflicting section, LaTeX block
and bibliography links across all Canvas pages. The check uses the current Writing drafts.
Choose **Locate card** to inspect the original node, or **Repair link** to search for and
confirm a replacement. A repair preserves the card, its notes and its connections. Use
**Undo repair** or the Canvas history controls to revert it.

In Writing, open **Review** to link a review comment or to-do to a heading, formula, or
text selection. Choose an existing Canvas card or create one on the destination page.
Filter by the current section, current file, or all Canvas pages. Status changes appear in
both views. A captured selection follows its text as it moves and becomes unavailable if the
text can no longer be identified reliably.

Run `bun run lint`, `bun run build`, and `bun run test` to check the project.
