import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import type { generateText, LanguageModel } from 'ai'

const providerFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error' })

export function isLocalAiRequest(request: Request) {
  const host = request.headers.get('host') ?? ''
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) && request.headers.get('origin') === `http://${host}`
}

export function configuredAi(): { model: LanguageModel; providerOptions: Parameters<typeof generateText>[0]['providerOptions'] } | undefined {
  const deepSeekKey = process.env.DEEPSEEK_API_KEY
  const openAIKey = process.env.OPENAI_API_KEY
  const openAIModel = process.env.OPENAI_MODEL
  if (deepSeekKey) return { model: createDeepSeek({ apiKey: deepSeekKey, fetch: providerFetch })(process.env.DEEPSEEK_MODEL || 'deepseek-flash'),
    providerOptions: { deepseek: { thinking: { type: 'disabled' } } } }
  if (openAIKey && openAIModel) return { model: createOpenAI({ apiKey: openAIKey, baseURL: process.env.OPENAI_BASE_URL, fetch: providerFetch }).responses(openAIModel),
    providerOptions: { openai: { store: false } } }
}
