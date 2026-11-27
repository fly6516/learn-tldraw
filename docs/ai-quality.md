# Writing AI quality baseline

Set `DEEPSEEK_API_KEY` in the local environment, leave `RESEARCH_TEST_MODE`
disabled, and make Tectonic available on PATH. Run the opt-in suite from the
repository root.
The [benchmark script](../scripts/ai-quality.ts) sends the included public
adaptations and synthetic fixtures to DeepSeek and
records each first response without repairing or resubmitting its proposal.

```sh
RESEARCH_AI_EVAL=1 LATEX_COMPILE_ENABLED=1 bun run scripts/ai-quality.ts
RESEARCH_AI_EVAL=1 LATEX_COMPILE_ENABLED=1 RESEARCH_AI_EVAL_CASE=synthetic-media bun run scripts/ai-quality.ts
```

Set `RESEARCH_AI_EVAL_CASE` to run an individual case. The Chinese case uses
`ctexart` and Fandol by default. On macOS, `RESEARCH_AI_EVAL_CJK_FONT='Songti SC'`
uses the installed font. Record that choice with the results. An unavailable
engine, font, or package stays a compile failure, separate from proposal quality.
With no case filter the suite runs all three manuscripts and both media checks.

| Case | What it checks | Material |
| --- | --- | --- |
| `public-chinese-adaptation` | Chinese wording, preservation of the census-block term and LaTeX label, and compilation | Chinese paraphrase of the methods in [McDonald et al. (2021), PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0249715), released into the public domain. |
| `public-journal-adaptation` | Multi-file two-column paper, qualifier preservation, and a named CSV column and physical line | Paraphrased results and transcribed approximate thresholds from section 4.2 of [Bae, Jang, and Kim (2026), PLOS Climate](https://journals.plos.org/climate/article?id=10.1371/journal.pclm.0000841), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). |
| `synthetic-complex-section` | Natural-language location in a long chapter and protection of an equation and its labels | Synthetic LaTeX. |
| `synthetic-media` | One PDF page's text and recognition of one image's color, with the corresponding filenames | Synthetic PDF text and PNG. |

The LaTeX projects reproduce selected structures for the benchmark. They are
adaptations of public research, not the publishers' original source packages.

Each JSON record reports whether the first response produced a proposal, whether
the exact patch compiled, whether the expected evidence matched where applicable,
and whether the automated checks passed. Retain failures, durations, the model
and the file/line or page evidence. The `humanAcceptance` field starts as
`not reviewed`. Review the first patch against the request, check scientific
meaning, qualifiers, units and groups, and record **accept**, **revise**, or
**reject**. Calculate acceptance only over reviewed first responses and report
the denominator. Keep this separate from the automated checks and from any
subsequent repair.

## Initial observed results

Verified with DeepSeek `deepseek-flash` and Tectonic. These are the first model
responses from the successful verification runs after correcting the benchmark
fixture and warming the TeX cache.

| Case | Proposal compiled | Automated rubric | Evidence | Human review |
| --- | --- | --- | --- | --- |
| Chinese public adaptation | Pass, Songti SC | Pass | Not applicable | Not reviewed |
| Public journal adaptation | Pass | Pass | CSV physical line 2 and `commercial_c` matched | Not reviewed |
| Synthetic complex section | Pass | Pass | Not applicable | Not reviewed |
| Synthetic PDF and PNG | Not applicable | Both passed | Correct PDF page and code; correct image color and path | Not reviewed |

For a later run, compare the exact first patches and check that terminology,
analysis units, qualifying language, and scope of inference are preserved. Confirm
the CSV line and column or the PDF page where applicable. An image uses its
attachment path. These results are a baseline, and author acceptance is reported
only for independently reviewed first responses.
