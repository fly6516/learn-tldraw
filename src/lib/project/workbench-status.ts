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
