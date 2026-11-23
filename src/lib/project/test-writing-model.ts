import { type LanguageModel } from 'ai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { testEvidence, testMethodEdit, testMethodLine, testMethods, testResultEdit, testResultLine, testResults, testScenarios } from './test-paper'
import type { ManuscriptContext } from './manuscript-task'
import { writingExerciseClaim, writingExerciseCommand, writingExerciseData, writingExercisePrompt, writingExerciseSubmission } from './writing-sample'

type Stream = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream']
type Part = Stream extends ReadableStream<infer Chunk> ? Chunk : never

function toolCall(name: string, input: object): Part {
  return { type: 'tool-call', toolCallId: name + ('path' in input ? String(input.path) : ''), toolName: name, input: JSON.stringify(input) }
}

function finish(unified: 'tool-calls' | 'stop' | 'length'): Part {
  return { type: 'finish', finishReason: { unified, raw: unified }, usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  } }
}

export function testWritingModel(selected: string[], text: string, feedback?: 'passed' | 'failed', revision = false, canDraft = false,
  manuscript?: ManuscriptContext, writingExample = false): LanguageModel {
  const scenario = text.trim().toLowerCase()
  const markdown = scenario === 'test: show markdown'
  const inlineEvidence = scenario === 'test: show inline evidence'
  const failed = scenario === testScenarios.fail.toLowerCase()
  const interrupted = scenario === testScenarios.interrupted.toLowerCase()
  const repair = scenario.startsWith('repair the selected changes')
  const access = scenario === 'test: request draft access'
  const citeCsv = scenario === 'test: read manuscript csv'
  const batch = manuscript?.mode === 'batch'
  const exercise = writingExample && manuscript?.goal === writingExercisePrompt
  const plannedData = batch && Boolean(manuscript.data?.length)
  const workflowFixture = scenario.includes('workflow acceptance') || scenario.includes('river publication') || scenario.includes('morning claim review')
  const morning = manuscript?.goal.toLowerCase().includes('morning claim review')
  const evidence = manuscript?.mode === 'evidence'
  const river = manuscript?.goal.toLowerCase().includes('river publication')
  const scopedRepair = manuscript?.mode === 'repair'
  const taskRepair = scenario.startsWith('repair the errors in the manuscript verification report')
  const broken = testResultEdit + ' \\undefinedFixtureCommand'
  const suggested = scenario === testScenarios.pass.toLowerCase() || failed || interrupted
    || ((repair || taskRepair) && feedback === 'failed') || (access && canDraft) || batch
  let step = 0
  return new MockLanguageModelV4({
    modelId: 'research-fixture',
    doStream: async () => {
      const turn = step++
      if (inlineEvidence) {
        const chunks: Part[] = turn === 0 ? [
          toolCall('read_source', { path: testMethods, startLine: 3, lineCount: 1 }),
          toolCall('read_source', { path: testResults, startLine: 3, lineCount: 1 }),
          toolCall('read_csv_rows', { path: 'data/sessions.csv', startRow: 2, rowCount: 1 }),
          toolCall('query_references', { query: 'oke2017', kind: 'bibliography' }), finish('tool-calls'),
        ] : [
          { type: 'text-start', id: 'inline' },
          { type: 'text-delta', id: 'inline', delta: 'Methods citation: sections/methods.tex:3. Unread line: sections/methods.tex:999.\n\n| Results | Data | Literature |\n| --- | --- | --- |\n| **sections/results.tex:3** | `data/sessions.csv:2` | `oke2017` |\n\n```text\nsections/methods.tex:3\n```' },
          { type: 'text-end', id: 'inline' }, finish('stop'),
        ]
        return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 20 }) }
      }
      if (markdown) {
        const deltas = [
          '## 修改摘要\n\n| 文件 | 说明 | 数据 | 引用 | 状态 | 附件 | 备注 |',
          '\n| --- | :--- | ---: | --- | --- | --- | --- |\n',
          '| `sections/methods.tex` | **已修订** | 28.1 | A \\| B | 保留 | `data/sessions.csv` | 已核对 |\n',
          '\n### 后续步骤\n\n1. 检查引用\n   - *补充说明*\n2. 再编译\n\n> ~~旧结果~~\n\n',
          '```latex\n\\input{sections/methods}\n' + 'x'.repeat(140) + '\n```\n\n',
          '[文档](https://example.com) [不安全](javascript:alert%281%29) ![远程图片](https://example.com/remote.png)\n\n<strong>原始 HTML</strong>',
        ]
        const chunks: Part[] = [{ type: 'text-start', id: 'markdown' },
          ...deltas.map(delta => ({ type: 'text-delta' as const, id: 'markdown', delta })),
          { type: 'text-end', id: 'markdown' }, finish('stop')]
        return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 300 }) }
      }
      const direct = 'The first recorded value was 28.1 degrees.'
      const calculated = 'The mean of the second and third sessions was 27.25 degrees.'
      const unsupported = 'Follow-up sessions improved by 12.9 degrees.'
      const documentedResult = 'The first recorded value was 28.1 degrees.'
      const statedResult = exercise ? `${testResultEdit}\n${writingExerciseClaim}\n${writingExerciseCommand}`
        : plannedData ? `${testResultEdit}\n${documentedResult}\nA follow-up measured 31.7 degrees.${river ? ' \\cite{syntheticGauge}' : ''}` : testResultEdit
      const edits = (morning && batch ? [
        { path: testMethods, before: 'Observers traversed the shaded and exposed routes at the same planned departure time.',
          after: 'The paired routes were surveyed at the same planned departure time.' },
        { path: testResults, before: 'The shaded route was cooler in each paired session. The largest gap appeared in the third session, when cloud cover remained low.',
          after: ['The shaded route was cooler in each paired session. The largest gap appeared in the third session, when cloud cover remained low.',
            '', direct, calculated, unsupported].join('\n') },
      ] : [
        { path: testMethods, before: testMethodLine, after: testMethodEdit },
        { path: testResults, before: taskRepair ? broken : testResultLine,
          after: failed || (batch && manuscript.goal.includes('include a compiler failure')) ? broken : statedResult },
        ...(batch ? ['notes/first.tex', 'notes/second.tex'].map(path => ({
          path, before: 'Original test note.', after: 'Edited test note.',
        })) : []),
      ]).filter(edit => selected.includes(edit.path))
      const requestedTool = revision ? ['read_archived_changes', {}] as const
        : exercise && manuscript?.mode === 'plan' ? ['plan_manuscript', { title: 'Practice manuscript recovery',
          files: [testMethods, testResults], decisions: ['Use the synthetic readings for the exercise.'], questions: [],
          delivery: { data: [{ path: writingExerciseData, startRow: 1, rowCount: 3 }], submissionName: writingExerciseSubmission } }] as const
        : writingExample && manuscript?.mode === 'plan' ? ['plan_manuscript', { title: 'Revise and submit Practice Paper',
          files: [testMethods, testResults], decisions: ['Keep the measurements synthetic.'], questions: [],
          delivery: { data: [], submissionName: 'Practice submission' } }] as const
        : workflowFixture && !batch ? ['plan_manuscript', { title: 'Prepare manuscript for review',
          files: scenario.includes('morning claim review') ? [testMethods, testResults] : [testMethods, testResults, 'notes/first.tex', 'notes/second.tex'], decisions: [], questions: [],
          delivery: { data: [{ path: 'data/sessions.csv', startRow: 1, rowCount: 3 }], submissionName: river || scenario.includes('river publication')
            ? 'River publication' : 'Workflow acceptance' } }] as const
        : manuscript?.mode === 'plan' ? ['plan_manuscript', { title: 'Revise Practice Paper',
          files: [testMethods, testResults, 'notes/first.tex', 'notes/second.tex'], decisions: ['Keep the original measurements.'],
          questions: ['Confirm the instrument model.'] }] as const
        : access && !canDraft ? ['request_edit_permission', { paths: [testMethods], reason: 'Revise the Methods working draft.' }] as const
        : scenario === 'test: compile preview' ? ['request_preview_compile', { reason: 'Check the current draft.' }] as const
        : scenario === 'test: prepare submission excluding references.bib'
          ? ['prepare_submission', { name: 'Submission v1', excluded: ['references.bib', '*.zip'] }] as const
        : scenario === 'test: create round 1 from submission v1' ? ['prepare_revision_round', { name: 'Round 1', baseline: 'Submission v1' }] as const
        : scenario === 'test: add reviewer comment clarify the reported results.' || scenario.startsWith('add the following reviewer comment')
          ? ['prepare_reviewer_comment', { path: testResults, round: 'Round 1', text: 'Clarify the reported results.' }] as const
        : scenario === 'test: reply to comment 1' ? ['request_reviewer_reply', { comment: 1, revised: 'Submission v2' }] as const
        : undefined
      const chunks: Part[] = turn === 0 && requestedTool ? [toolCall(requestedTool[0], requestedTool[1]), finish('tool-calls')]
        : turn === 1 && revision ? [
          toolCall('propose_reply', { draft: 'We clarified the synthetic mean temperature in the Results.' }), finish('tool-calls'),
        ] : turn === 0 && citeCsv ? [
          toolCall('list_attachments', {}), toolCall('read_csv_rows', { path: 'data/sessions.csv', startRow: 2, rowCount: 2 }), finish('tool-calls'),
        ] : evidence ? turn === 0 ? [
          morning ? toolCall('calculate_csv', { path: 'data/sessions.csv', operation: 'mean', decimals: 2,
            cells: [{ row: 3, column: 'shaded_c' }, { row: 4, column: 'shaded_c' }] })
            : toolCall('read_csv_rows', { path: 'data/sessions.csv', startRow: 3, rowCount: 2 }),
          finish('tool-calls'),
        ] : [toolCall('resolve_claim_evidence', morning ? { references: [], calculationIds: ['calc-1'] }
          : { references: [{ path: 'data/sessions.csv', line: 3 }, { path: 'data/sessions.csv', line: 4 }] }), finish('tool-calls')]
        : turn === 0 && scopedRepair ? [
          toolCall('read_patch_verification', {}), finish('tool-calls'),
        ] : turn === 0 && plannedData ? [toolCall('read_manuscript_data', {}), finish('tool-calls')]
        : (turn === Number(plannedData) && batch) || (turn === 1 && scopedRepair) ? [
          ...edits.map(edit => toolCall('read_source', { path: edit.path, startLine: 1, lineCount: 4 })), finish('tool-calls'),
        ] : exercise && batch && turn === 2 ? [
          toolCall('calculate_csv', { path: writingExerciseData, operation: 'mean', decimals: 2,
            cells: [{ row: 2, column: 'temp_c' }, { row: 3, column: 'temp_c' }] }), finish('tool-calls'),
        ] : turn === 0 ? [
        toolCall('search_source', { query: testEvidence }),
        toolCall('read_source', { path: testMethods, startLine: 2, lineCount: 2 }),
        toolCall('read_source', { path: testResults, startLine: 2, lineCount: 4 }),
        finish('tool-calls'),
      ] : turn === (exercise ? 3 : scopedRepair || plannedData ? 2 : 1) && suggested && edits.length ? [
        toolCall('propose_edits', { summary: 'Fixture wording changes for review.', edits,
          claims: exercise ? [{ path: testResults, quote: writingExerciseClaim, references: [], calculationIds: ['calc-1'] }]
            : plannedData && selected.includes(testResults) ? [
            { path: testResults, quote: documentedResult, references: [{ path: 'data/sessions.csv', line: 2 }] },
            ...(morning ? [{ path: testResults, quote: calculated, references: [] }, { path: testResults, quote: unsupported, references: [] }] : []),
          ] : undefined }), finish('tool-calls'),
      ] : [
        { type: 'text-start', id: 'fixture' },
        { type: 'text-delta', id: 'fixture', delta: interrupted ? 'Interrupted fixture response.' : 'Fixture response. ' },
        { type: 'text-delta', id: 'fixture', delta: interrupted ? ' The proposal is incomplete.'
          : scenario === 'test: explain build' ? feedback ? `The compiler result is available: ${feedback}.` : 'No compiler result was received.'
          : 'Open the source evidence and review the proposed changes.' },
        { type: 'text-end', id: 'fixture' },
        finish(interrupted ? 'length' : 'stop'),
      ]
      return { stream: simulateReadableStream({ chunks, initialDelayInMs: 25, chunkDelayInMs: interrupted && turn > 1 ? 500 : 35 }) }
    },
  })
}
