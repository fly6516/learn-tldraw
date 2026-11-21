# Research Canvas

Install dependencies with `bun install --frozen-lockfile` and start the app with `bun run dev`.
Open http://localhost:3000 to choose a workspace.

- `/research` is the research workspace. Canvas and project files are saved in the current browser.
- `/research-dev` is a sample paper workspace.

Use **Add Research Node** to create a card and select it to edit its content and section
properties. Draw directed connections from a card's outgoing handle, or choose a target in
the node properties. **Add Page** creates another graph in the project. Canvas exports use
the selected page and its directed connections.

Use **Project Backup** to download a `.research-canvas` file. In another browser, choose the
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

1. In `/research`, choose **Import LaTeX → Import Project ZIP**. A Prism or ordinary
   LaTeX ZIP keeps its directory paths, original source bytes, and attachments.
2. In the files panel, choose **Edit and Compile LaTeX**. Select the main `.tex` file and the
   chapter to edit. The compiler runs from the main file's directory, so its relative references
   keep their original meaning.
3. Choose **Compile PDF** to save the current edit and compile the whole project. The PDF and
   compile errors appear next to the editor. **Export → LaTeX ZIP** downloads the edited source tree.

The compile endpoint accepts ZIPs up to 32 MB, including after extraction. The standard compiler
supports XeLaTeX and BibTeX workflows. Documents that require a different engine, Biber, or
shell escape may need external compilation. The canvas preview and print workflow are also
available from the canvas menu.

## AI chapter editing

Set `DEEPSEEK_API_KEY` on the local Next.js server to use the official DeepSeek API.
`DEEPSEEK_MODEL` defaults to `deepseek-flash`. For OpenAI instead, set `OPENAI_API_KEY` and
`OPENAI_MODEL` to a model that supports Structured Outputs on the Responses API.
`OPENAI_BASE_URL` optionally points to a compatible Responses server. Keep the key on the
server and run the workbench on loopback.

Select a `.tex` file in **Edit source**, open **Chapter AI**, then choose **Review Chapter**
or **Rewrite Chapter**. The request includes the selected draft, related source excerpts such
as the main file, bibliography and local macros, and the end of the most recent compile log.
Review the before/after passages and choose **Apply to Source** to save the edits to that file.
Choose **Compile PDF** to typeset the updated project.

## References

Open **References** in the LaTeX editor to search project `.bib` entries by key, title,
author, or year. **Insert** adds `\cite{key}` at the source editor's caret or replaces its
current selection. Citation issues list missing keys in project `.tex` files and each
definition of a duplicate key. Click an issue to select the key in its source file.
The check uses all project bibliographies and includes the currently edited draft. AI
suggestions flag new citation keys that have no matching project bibliography entry.

Open **Outline** to browse headings from the selected main file and its statically linked
`\input` and `\include` files. The outline follows document order and nests subheadings under
their parents. Click any title to select it in the source editor. Unsaved title edits update
the outline as you type.

Run `bun run lint`, `bun run build`, and `bun test` to check the project.
