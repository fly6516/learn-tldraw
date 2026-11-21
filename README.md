# Research Canvas

Install dependencies with `bun install --frozen-lockfile` and start the app with `bun run dev`.
Open http://localhost:3000 to choose a workspace.

- `/research` opens the research project's **Canvas** view. Canvas and project files are saved
  in the current browser. **Writing** uses `/research?view=write` and is part of the same project.
- `/research-dev` uses the same views with a sample paper.

Use **Add node** to create a card and select it to edit its content and section
properties. Draw directed connections from a card's outgoing handle, or choose a target in
the node properties. **Add Page** creates another graph in the project. Canvas exports use
the selected page and its directed connections.

Use **Project menu → Project Backup** to download a `.research-canvas` file. In another browser, choose the
file from the same dialog and confirm **Replace Project**. The backup includes all canvas
pages, nodes, connections, viewports, and project files. This release starts with a new
canvas storage format and supports version 2 project backups.

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
3. Choose **Compile PDF** to save your drafts and compile the whole project from the main
   file's directory. **PDF Preview** shows the latest successful build. Citation issues and
   compiler errors with a source location are underlined in the editor. Select an entry in
   **Problems** to jump to its file and line, or expand **Compiler log** for more detail.
   On desktop, **Problems**, **References**, and **Chapter AI** open below the editor and PDF.
   On narrow screens, use **Source**, **PDF**, and the **Files** drawer. **Project menu →
   Export LaTeX ZIP** downloads the saved source tree.

After compiling, place the cursor on a LaTeX line and choose **Show in PDF** to highlight
its typeset location. Click typeset content in **PDF Preview** to open its source file
and line. When a source line has no typeset output, the forward jump uses the nearest
mapped line in the same file. Compile again after editing to refresh both directions.

The compile endpoint accepts ZIPs up to 32 MB, including after extraction. The standard compiler
supports XeLaTeX and BibTeX workflows. Documents that require a different engine, Biber, or
shell escape may need external compilation. The canvas preview and print workflow are also
available in **Canvas** and the project menu.

## AI chapter editing

Set `DEEPSEEK_API_KEY` on the local Next.js server to use the official DeepSeek API.
`DEEPSEEK_MODEL` defaults to `deepseek-flash`. For OpenAI instead, set `OPENAI_API_KEY` and
`OPENAI_MODEL` to a model that supports Structured Outputs on the Responses API.
`OPENAI_BASE_URL` optionally points to a compatible Responses server. Keep the key on the
server and run the workbench on loopback.

Select a `.tex` file in **Files**, open **Chapter AI**, then choose **Review Chapter**
or **Rewrite Chapter**. The request includes the selected draft, related source excerpts such
as the main file, bibliography and local macros, and the end of the most recent compile log.
Review the before/after passages and choose **Apply to Source** to save the edits to that file.
Choose **Compile PDF** to typeset the updated project.

## References

Open **References** in the LaTeX editor to search project `.bib` entries by key, title,
author, or year. **Insert** adds `\cite{key}` at the source editor's caret or replaces its
current selection. Citation issues list missing keys in project `.tex` files and each
definition of a duplicate key. Click an issue to select the key in its source file.
The check uses all project bibliographies and includes unsaved drafts. AI
suggestions flag new citation keys that have no matching project bibliography entry.

Open **Outline** to browse headings from the selected main file and its statically linked
`\input` and `\include` files. The outline follows document order and nests subheadings under
their parents. Click any title to select it in the source editor. Unsaved title edits update
the outline as you type.

Run `bun run lint`, `bun run build`, and `bun test` to check the project.
