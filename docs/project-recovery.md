# Recover a local project

From **Project menu → Project Backup**, choose **Complete recovery backup** and
download the file. This includes the Canvas, saved sources and attachments, local
drafts, submission versions, revision rounds, and project snapshots. You can add
AI conversations and task history when you need to transfer them.

For a project bound to a published official attachment release, a complete backup
also includes the exact release package and its acceptance records. When you
import the project, its release is restored with the project. The receiving
browser keeps its current template market publications. The workbench can use
the restored attachments for a DOCX export without reaching the publisher. Run
the local workbench and its Word conversion service for the export.

The workbench checks the archive before asking the browser to download it. The
project list records the last export, its contents, and whether that complete
backup matches the currently saved project and drafts. Keep the downloaded file
somewhere outside the browser's site data and check that it exists.

If a local write fails, leave the tab open. Use **Back up working drafts** in
Writing or **Back up this tab** for a project storage failure. Those backups
capture the contents still held by the tab. **Download working copy only** can
export the files, Canvas, and available drafts if project history is unreadable.

In another browser, use **Import project**, select the backup, and review its
contents. **Import as new project** keeps existing projects intact. Verify the
drafts and important archived submissions before discarding the previous copy.

Backups with optional history use format version 4. Versions 2 and 3 remain
supported. The backup checks included archives and attachments during import.
For an existing project, review which history categories will be replaced
before confirming. Drafts with a different saved baseline open in Writing's
comparison view.

The attachment regression restores separate ZJU and NJUPT projects from
Chromium into Firefox with publisher requests blocked. It compares the archived
PDF, source ZIP, generated DOCX and Word-final DOCX checksums, then exports a
new DOCX and compares its template, attachment manifest and manuscript snapshot.

To reproduce this check, run the `attachments` group in [Template support and
verification](official-template-acceptance.md#复现).
