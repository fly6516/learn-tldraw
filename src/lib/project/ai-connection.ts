import { APICallError, InvalidResponseDataError, streamText, tool, ToolChoiceViolationError, UnsupportedFunctionalityError } from 'ai'
import { z } from 'zod'
import { configuredAi } from './ai-provider'
import { modelFailureMessages, type ModelConnection, type ModelFailure } from './workbench-status'

function failure(state: ModelFailure['state']): ModelFailure {
  return { state, message: modelFailureMessages[state] }
}

export function modelFailure(cause: unknown, timedOut = false): ModelFailure {
  const status = APICallError.isInstance(cause) ? cause.statusCode : undefined
  if (timedOut || status === 408 || status === 504) return failure('timeout')
  if (status === 401 || status === 403) return failure('authentication')
  if (status === 429) return failure('rate-limit')
  if (ToolChoiceViolationError.isInstance(cause) || InvalidResponseDataError.isInstance(cause)
    || UnsupportedFunctionalityError.isInstance(cause) || status === 400 || status === 404 || status === 405 || status === 422) return failure('incompatible')
  return failure('unavailable')
}

export async function checkModelConnection(signal: AbortSignal, provider = configuredAi(), timeoutMs = 25_000): Promise<ModelConnection> {
  if (!provider) return failure('unconfigured')
  const timeout = AbortSignal.timeout(timeoutMs)
  let completed = false
  let usedTool = false
  let failed: ModelConnection | undefined
  try {
    const result = streamText({
      model: provider.model, providerOptions: provider.providerOptions, maxRetries: 0, maxOutputTokens: 128,
      abortSignal: AbortSignal.any([signal, timeout]),
      prompt: 'Run the connection_check tool with no arguments.',
      toolChoice: 'required',
      tools: { connection_check: tool({
        description: 'Return the fixed workbench connection check result.',
        inputSchema: z.object({}),
        execute: async () => ({ connected: true }),
      }) },
      onError: ({ error }) => { failed = modelFailure(error, timeout.aborted) },
    })
    for await (const part of result.fullStream) {
      if (part.type === 'tool-result' && part.toolName === 'connection_check') usedTool = true
      if (part.type === 'finish') completed = part.finishReason === 'tool-calls' || part.finishReason === 'stop'
    }
  } catch (error) {
    return modelFailure(error, timeout.aborted)
  }
  if (timeout.aborted) return modelFailure(undefined, true)
  if (failed) return failed
  return completed && usedTool && !signal.aborted
    ? { state: 'ready', message: 'Model connection verified. Streaming and tool calls work.', recipient: provider.recipient.slice(0, 300) }
    : { state: 'incompatible', message: 'The model did not complete a streamed tool call. Check the configured model and endpoint.' }
}
