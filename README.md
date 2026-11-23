# Research Canvas

Install dependencies with `bun install --frozen-lockfile` and start the app with `bun run dev`.
Open http://localhost:3000 to choose a workspace.

- `/research` opens the research project's **Canvas** view. Canvas and project files are saved
  in the current browser. **Writing** uses `/research?view=write` and is part of the same project.
- `/research-dev` uses the same views with a sample paper.

Use **Add node** to create a card. **Select** moves nodes and box-selects them, **Pan** moves
the viewport, and **Connect** links two cards in click order or by dragging from an outgoing
handle. The toolbar offers **Undo**, **Redo**, **Delete selection**, and **Fit View**.
Undo and redo apply to edits on the current canvas page, including moves, node edits, and
connections. Use Ctrl/Cmd+Z or Ctrl/Cmd+Shift+Z when the canvas has focus. **Add Page** creates
another graph in the project. Canvas exports use the selected page and its directed connections.

Use **Project search** from the project menu or Canvas toolbar to find cards, Writing source,
or bibliography entries. Source results include local drafts. Linked results offer a direct
jump to the other view when the match overlaps a linked source target.

Use **Project menu → Project Backup** to download a `.research-canvas` file. In another browser, choose the
file from the same dialog and confirm **Replace Project**. The backup includes all canvas
pages, nodes, connections, viewports, and saved project files. Select **Include local drafts**
to carry those edits and the Writing cursor separately from the saved source. A restored draft
with a different baseline opens in the normal Writing comparison flow. Version 2 backups are
still supported. Backups carrying drafts use version 3.

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

In **Responses and letter**, write a response for each comment. Link the changed files or
explain why you kept the text. After archiving the revised submission, select it in the round.
**Compare files** can then show the two archived ZIPs directly. Preview or download the
response letter as Markdown. The letter marks unanswered comments and evidence that cannot
be verified against the selected revised ZIP.

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

Open **Writing AI** from the Writing tools bar. The panel sits on the right beside the
editor and PDF on wide windows and opens as a right-side drawer on smaller windows.
Use **Expand** to make it wider or close it to reclaim the full work area. Canvas node and
connection details use the same controls.

The assistant streams its replies and tool activity. The Chapter, Across files and Compiler
problems workflows guide it through bounded source excerpts, project search, reference lookup,
and compiler diagnostics. Open **Source evidence** to jump to the file and line. A preview
compile request uses the regular compiler only after you approve it. Conversations are stored
per project in this browser. The model receives recent conversation text, project paths, and
the excerpts returned by its tools.

Use **Scope** to select up to six editable LaTeX files. By default, inspect **View diff** and
select changes before choosing **Apply to drafts**. **Save to project** is a separate action.
The project checks the saved source and local draft before applying or saving. **Undo AI changes**
restores the original source and draft for the affected files while protecting later edits.

Choose **Verify selected changes** to compile a temporary snapshot of the working sources
with only the checked edits applied. Review the result and jump from a diagnostic to the
corresponding line in Writing. Verification keeps your source files, drafts, and last PDF
intact. Changes to the source, compile entry, or selection make the result out of date.

**Save if verification passes** authorizes that proposal and selection to save after a
fresh passing build. A failed or outdated build leaves the project untouched. Unrelated
local drafts can take part in verification and stay local afterward. **Auto draft** is
available for the approved files in the current conversation. Refreshing or switching
conversations clears that approval.

Each proposal has an **AI task record**. Expand **Task activity** to see its approvals,
verification attempts, saves, and undo actions after reloading. Source evidence follows
tracked Writing file moves and uniquely identifiable lines. When it cannot be located
reliably, **Find fresh evidence** prepares a follow-up request in the same conversation.

Choose **Reviewer reply** to open Revision rounds. Select a revised submission and the files
that support the response before choosing **Draft response with AI**. This workflow reads bounded
excerpts from the archived ZIPs. **Use AI draft** copies the streamed proposal into the response
editor for review before saving.

## References

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

Run `bun run lint`, `bun run build`, and `bun test` to check the project.
