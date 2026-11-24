import { expect, test } from 'bun:test'
import { createOpenAI } from '@ai-sdk/openai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { checkModelConnection } from './ai-connection'

function provider(fetch) {
  return { model: createOpenAI({ apiKey: 'fixture-key', baseURL: 'https://fixture.invalid/v1', fetch }).responses('fixture-model'),
    providerOptions: { openai: { store: false } }, recipient: 'OpenAI-compatible · fixture-model' }
}

function streamEvents(...events) {
  return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

test('verifies a tool call over the OpenAI-compatible streaming interface with a synthetic request', async () => {
  let sent
  const item = { type: 'function_call', id: 'item_fixture', call_id: 'call_fixture', name: 'connection_check', arguments: '{}' }
  const result = await checkModelConnection(new AbortController().signal, provider(async (_url, init) => {
    sent = JSON.parse(init.body)
    return streamEvents(
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item: { ...item, status: 'completed' } },
      { type: 'response.completed', response: {} },
    )
  }))
  expect(result.state).toBe('ready')
  expect(sent).toMatchObject({ stream: true, store: false, tool_choice: 'required', tools: [{ name: 'connection_check' }] })
  expect(JSON.stringify(sent)).toContain('with no arguments')
  expect(JSON.stringify(sent)).not.toContain('fixture-key')
})

test('classifies upstream errors without leaking the response, and bounds a stalled request', async () => {
  for (const [status, state] of [[401, 'authentication'], [404, 'incompatible'], [429, 'rate-limit'], [500, 'unavailable']]) {
    const result = await checkModelConnection(new AbortController().signal, provider(async () =>
      Response.json({ error: { message: 'private upstream details' } }, { status })))
    expect(result.state).toBe(state)
    expect(result.message).not.toContain('private upstream details')
  }
  const timedOut = await checkModelConnection(new AbortController().signal, provider(async (_url, init) => {
    await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))
  }), 25)
  expect(timedOut.state).toBe('timeout')
  const noTool = await checkModelConnection(new AbortController().signal, { recipient: 'fixture',
    model: new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
      { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Hello' }, { type: 'text-end', id: 'text' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 } } },
    ] }) }) }),
  })
  expect(noTool.state).toBe('incompatible')
})
