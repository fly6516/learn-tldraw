import { type LanguageModel } from 'ai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { testEvidence, testMethodEdit, testMethodLine, testMethods, testResultEdit, testResultLine, testResults, testScenarios } from './test-paper'

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

export function testWritingModel(selected: string[], text: string): LanguageModel {
  const scenario = text.trim().toLowerCase()
  const failed = scenario === testScenarios.fail.toLowerCase()
  const interrupted = scenario === testScenarios.interrupted.toLowerCase()
  const suggested = scenario === testScenarios.pass.toLowerCase() || failed || interrupted
  let step = 0
  return new MockLanguageModelV4({
    modelId: 'research-fixture',
    doStream: async () => {
      const turn = step++
      const edits = [
        { path: testMethods, before: testMethodLine, after: testMethodEdit },
        { path: testResults, before: testResultLine, after: failed ? testResultEdit + ' \\undefinedFixtureCommand' : testResultEdit },
      ].filter(edit => selected.includes(edit.path))
      const chunks: Part[] = turn === 0 ? [
        toolCall('search_source', { query: testEvidence }),
        toolCall('read_source', { path: testMethods, startLine: 2, lineCount: 2 }),
        toolCall('read_source', { path: testResults, startLine: 2, lineCount: 4 }),
        finish('tool-calls'),
      ] : turn === 1 && suggested && edits.length ? [
        toolCall('propose_edits', { summary: 'Fixture wording changes for review.', edits }), finish('tool-calls'),
      ] : [
        { type: 'text-start', id: 'fixture' },
        { type: 'text-delta', id: 'fixture', delta: interrupted ? 'Interrupted fixture response.' : 'Fixture response. ' },
        { type: 'text-delta', id: 'fixture', delta: interrupted ? ' The proposal is incomplete.' : 'Open the source evidence and review the proposed changes.' },
        { type: 'text-end', id: 'fixture' },
        finish(interrupted ? 'length' : 'stop'),
      ]
      return { stream: simulateReadableStream({ chunks, initialDelayInMs: 25, chunkDelayInMs: interrupted && turn > 1 ? 500 : 35 }) }
    },
  })
}
