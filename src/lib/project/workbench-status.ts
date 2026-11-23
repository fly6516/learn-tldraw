export type WorkbenchStatus = {
  compiler: 'ready' | 'disabled' | 'missing' | 'resources' | 'unavailable'
  cachedOnly: boolean
  model: { provider: 'DeepSeek' | 'OpenAI-compatible'; model: string } | null
}

export type StorageStatus = 'ready' | 'checking' | 'unavailable'
