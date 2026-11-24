export type WorkbenchStatus = {
  compiler: 'ready' | 'disabled' | 'missing' | 'resources' | 'unavailable'
  cachedOnly: boolean
  model: { provider: 'DeepSeek' | 'OpenAI-compatible'; model: string } | null
  preparation: ResourcePreparation
}

export type ResourcePreparation =
  | { state: 'idle' }
  | { state: 'running'; startedAt: number }
  | { state: 'ready' }
  | { state: 'failed'; message: string }

export type StorageStatus = 'ready' | 'checking' | 'unavailable'

export const modelFailureMessages = {
  unconfigured: 'Set a model API key in .env.local and restart the workbench.',
  authentication: 'The provider rejected access. Check the server API key and model permissions, then restart.',
  'rate-limit': 'The provider is limiting requests. Check the account quota or wait before retrying.',
  timeout: 'The model timed out. Check your connection and try again.',
  incompatible: 'Check the configured model and endpoint. Writing AI requires streaming and tool calls.',
  unavailable: 'The model service did not complete the request. Check the connection and try again.',
}
export type ModelFailure = { state: keyof typeof modelFailureMessages; message: string }
export type ModelConnection = ModelFailure | { state: 'ready'; message: string; recipient: string }
