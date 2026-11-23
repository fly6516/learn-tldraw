import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import type { generateText, LanguageModel } from 'ai'

const providerFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error' })

export function isLocalAiRequest(request: Request) {
  const host = request.headers.get('host') ?? ''
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) && request.headers.get('origin') === `http://${host}`
}

export function aiProviderStatus(env = process.env) {
  if (env.DEEPSEEK_API_KEY?.trim()) return { provider: 'DeepSeek' as const, model: env.DEEPSEEK_MODEL || 'deepseek-flash' }
  if (env.OPENAI_API_KEY?.trim() && env.OPENAI_MODEL?.trim()) return { provider: 'OpenAI-compatible' as const, model: env.OPENAI_MODEL }
}

export function configuredAi(): { model: LanguageModel; providerOptions: Parameters<typeof generateText>[0]['providerOptions']; recipient: string } | undefined {
  const configured = aiProviderStatus()
  if (configured?.provider === 'DeepSeek') return { model: createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY, fetch: providerFetch })(configured.model),
    recipient: `DeepSeek · ${configured.model}`, providerOptions: { deepseek: { thinking: { type: 'disabled' } } } }
  if (configured) return { model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL, fetch: providerFetch }).responses(configured.model),
    recipient: `${configured.provider} · ${configured.model}`, providerOptions: { openai: { store: false } } }
}
