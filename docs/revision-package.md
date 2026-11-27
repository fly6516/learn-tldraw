# Export a revision package

In **Prepare submission → Archived submissions**, open the original saved
submission and choose **Start revision**. Open the round in Writing. Choose **Reviewer comments → Paste review letter** and
paste the editor or reviewer's text. **Preview comments** recognizes common
English and Chinese editor and reviewer headings and numbered or bulleted
comments. Check the attribution and text in the preview. You can remove mail
boilerplate, edit or add comments, and link individual comments to project
sources. Comments about the whole manuscript can keep that target. Select
**Add comments to the round** to save the batch. The pasted letter stays in
the browser during this step.

After import, **Edit comment** changes the attribution, wording, or source
link. Choose an existing Canvas review card to open the linked reply and
evidence directly from its node details. **Split comment** keeps the existing
reply as a draft on the first comment and adds the second as unanswered.
Use **Move up** and **Move down** to set the letter order and **Response
status** to find outstanding replies and reviews. Confirm drafts again after
editing or splitting their comments.

Open **Revision rounds → Responses and letter**, choose the archived revised
submission, and select the relevant change blocks under **Evidence changes**.
Open **View changed text** to compare the original and revised lines before
saving each reply. The response letter lists the selected line ranges relative
to the archived source ZIPs. A text-retained reply can be saved with a rationale.
Changing the selected revised archive keeps the replies and requires new
evidence confirmation. Older file-only replies also need this confirmation.
Once every comment has a response and the selected change ranges are verified,
select **Download revision package**.

The package contains the revised archive's clean `manuscript.pdf` and original
`source.zip` bytes, the `response.md` letter, and `manifest.json` with the two
archive identities and the SHA-256 checksums of the delivered files. Working
drafts stay in the project. If the round changes in a different tab, reopen
the round and review its current replies before exporting.

## AGU revised submission

Archive a clean build from **Prepare submission → AGU · 修回稿** and link it
as the revised submission in the revision round. After confirming all replies,
return to the AGU stage, select **关联返修轮次**, then choose **载入本轮清洁稿并生成回复 PDF**. The letter
uses the local XeLaTeX compiler. Chinese text uses the existing CTeX and
Fandol setup.

Upload the marked copy through the existing attachment slot. Compare it
against the original and clean archive shown in the panel, then complete the
submission checks. The file format and hashes are checked automatically.
The author confirms that the marks correspond to the selected pair of
archives. Loading a different archive or reloading the round starts a fresh
material check.

**归档并下载 AGU 正式返修包** stores and downloads the exact ZIP. Its report
and manifest identify the round, original and clean archives, verified reply,
and each attachment by checksum. In **AGU 正式交付归档**, **校验并下载原始交付包**
checks the saved ZIP before downloading its original bytes. Project backups
that include submission history include these archived deliveries.

## Verify with the included sample

Use the [sample review letter](../tests/e2e/fixtures/review-letter.txt) for the
editor and two-reviewer workflow. After building the app and installing
Chromium, run the browser test from the repository root.

```sh
bun run test:e2e tests/e2e/review-letter.spec.ts
```

The test covers editing and ordering imported comments, finding the linked
reply and evidence, rechecking after changing archives, and matching the
exported files to their checksums. The [AGU formal delivery browser
case](../tests/e2e/template-export.spec.ts) uses the verified AGU ZIP in
`RESEARCH_TEMPLATE_PINNED_FIXTURES`. With local TeX enabled and
`RESEARCH_TEMPLATE_EXPORT_ACCEPTANCE=1`, select it with
`-g 'archives a verified AGU revision delivery'`. See [template test
setup](official-template-acceptance.md#复现).
