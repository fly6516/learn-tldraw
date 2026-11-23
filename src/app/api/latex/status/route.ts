import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { aiProviderStatus, isLocalAiRequest } from '@/lib/project/ai-provider'
import type { WorkbenchStatus } from '@/lib/project/workbench-status'

export const runtime = 'nodejs'
const exec = promisify(execFile)
const probe = String.raw`\documentclass{article}
\begin{document}
Research Canvas
\end{document}
`
let pending: Promise<WorkbenchStatus['compiler']> | undefined

async function checkCompiler(): Promise<WorkbenchStatus['compiler']> {
  if (process.env.LATEX_COMPILE_ENABLED !== '1') return 'disabled'
  const binary = process.env.TECTONIC_BIN || 'tectonic'
  const options = { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 }
  try {
    await exec(binary, ['--version'], options)
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable'
  }
  let folder: string | undefined
  try {
    folder = await mkdtemp(join(tmpdir(), 'research-status-'))
    await writeFile(join(folder, 'check.tex'), probe)
    await exec(binary, ['--untrusted', '--only-cached', '--', 'check.tex'], { ...options, cwd: folder })
    return (await readFile(join(folder, 'check.pdf'))).subarray(0, 5).toString() === '%PDF-' ? 'ready' : 'unavailable'
  } catch (cause) {
    const { stderr, stdout } = cause as { stderr?: string; stdout?: string }
    const output = `${stderr ?? ''}\n${stdout ?? ''}`
    return /bundle|cache|not in the search path|physical.*font|could not load.*font/i.test(output) ? 'resources' : 'unavailable'
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {})
  }
}

export async function POST(request: Request) {
  if (!isLocalAiRequest(request)) return Response.json({ error: 'Setup checks are available from the local workbench only.' }, { status: 403 })
  if (new URL(request.url).searchParams.get('check') === 'model') {
    const model = aiProviderStatus()
    const recipient = process.env.RESEARCH_TEST_MODE === '1' ? 'Local test model' : model ? `${model.provider} · ${model.model}` : null
    return Response.json({ recipient: recipient?.slice(0, 300) ?? null }, { headers: { 'Cache-Control': 'no-store' } })
  }
  pending ??= checkCompiler().finally(() => { pending = undefined })
  const status: WorkbenchStatus = { compiler: await pending, cachedOnly: process.env.TECTONIC_ONLY_CACHED === '1', model: aiProviderStatus() ?? null }
  return Response.json(status, { headers: { 'Cache-Control': 'no-store' } })
}
