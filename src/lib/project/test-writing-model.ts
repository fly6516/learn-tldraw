import { type LanguageModel } from 'ai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { testEvidence, testMethodEdit, testMethodLine, testMethods, testResultEdit, testResultLine, testResults, testScenarios } from './test-paper'
import type { ManuscriptContext } from './manuscript-task'

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
  manuscript?: ManuscriptContext): LanguageModel {
  const scenario = text.trim().toLowerCase()
  const failed = scenario === testScenarios.fail.toLowerCase()
  const interrupted = scenario === testScenarios.interrupted.toLowerCase()
  const repair = scenario.startsWith('repair the selected changes')
  const access = scenario === 'test: request draft access'
  const citeCsv = scenario === 'test: read manuscript csv'
  const batch = manuscript?.mode === 'batch'
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
      const edits = [
        { path: testMethods, before: testMethodLine, after: testMethodEdit },
        { path: testResults, before: taskRepair ? broken : testResultLine,
          after: failed || (batch && manuscript.goal.includes('include a compiler failure')) ? broken : testResultEdit },
        ...(batch ? ['notes/first.tex', 'notes/second.tex'].map(path => ({
          path, before: 'Original test note.', after: 'Edited test note.',
        })) : []),
      ].filter(edit => selected.includes(edit.path))
      const requestedTool = revision ? ['read_archived_changes', {}] as const
        : manuscript?.mode === 'plan' ? ['plan_manuscript', { title: 'Revise Practice Paper',
          files: [testMethods, testResults, 'notes/first.tex', 'notes/second.tex'], decisions: ['Keep the original measurements.'],
          questions: ['Confirm the instrument model.'] }] as const
        : access && !canDraft ? ['request_edit_permission', { paths: [testMethods], reason: 'Revise the Methods working draft.' }] as const
        : scenario === 'test: compile preview' ? ['request_preview_compile', { reason: 'Check the current draft.' }] as const
        : scenario === 'test: prepare submission' ? ['prepare_submission', { name: 'Submission v1', excluded: ['references.bib'] }] as const
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
        ] : turn === 0 && scopedRepair ? [
          toolCall('read_patch_verification', {}), finish('tool-calls'),
        ] : (turn === 0 && batch) || (turn === 1 && scopedRepair) ? [
          ...edits.map(edit => toolCall('read_source', { path: edit.path, startLine: 1, lineCount: 4 })), finish('tool-calls'),
        ] : turn === 0 ? [
        toolCall('search_source', { query: testEvidence }),
        toolCall('read_source', { path: testMethods, startLine: 2, lineCount: 2 }),
        toolCall('read_source', { path: testResults, startLine: 2, lineCount: 4 }),
        finish('tool-calls'),
      ] : turn === (scopedRepair ? 2 : 1) && suggested && edits.length ? [
        toolCall('propose_edits', { summary: 'Fixture wording changes for review.', edits }), finish('tool-calls'),
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
