import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { aiProviderStatus, isLocalAiRequest } from '@/lib/project/ai-provider'
import { claimLocalCompiler, writeCompileSources } from '@/lib/project/local-compile'
import { createTestPaper } from '@/lib/project/test-paper'
import type { ResourcePreparation, WorkbenchStatus } from '@/lib/project/workbench-status'

export const runtime = 'nodejs'
const exec = promisify(execFile)
const probe = String.raw`\documentclass{article}
\begin{document}
Research Canvas
\end{document}
`
let pending: Promise<WorkbenchStatus['compiler']> | undefined
let preparation: ResourcePreparation = { state: 'idle' }

async function prepareResources(release: () => void) {
  let folder: string | undefined
  try {
    folder = await mkdtemp(join(tmpdir(), 'research-resources-'))
    await writeCompileSources(folder, await createTestPaper())
    await exec(process.env.TECTONIC_BIN || 'tectonic', ['--untrusted', '--', 'main.tex'], {
      cwd: folder, windowsHide: true, timeout: 360_000, maxBuffer: 2 * 1024 * 1024,
    })
    if ((await readFile(join(folder, 'main.pdf'))).subarray(0, 5).toString() !== '%PDF-') throw new Error('No PDF was created')
    preparation = { state: 'ready' }
  } catch (cause) {
    const failure = cause as NodeJS.ErrnoException & { killed?: boolean; stderr?: string; stdout?: string }
    const output = [failure.stdout, failure.stderr].join('\n')
    const message = failure.killed ? 'Resource preparation timed out. Retry to continue using the files already downloaded.'
      : failure.code === 'ENOENT' ? 'Tectonic could not be started. Check the compiler in Setup.'
        : /network|connect|download|dns|http|tls|fetch|bundle/i.test(output)
          ? 'Tectonic could not download its resources. Check your internet connection and retry.'
          : 'Tectonic could not compile the built-in sample. Check the temporary directory and local compiler, then retry.'
    preparation = { state: 'failed', message }
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {})
    release()
  }
}

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
  const check = new URL(request.url).searchParams.get('check')
  if (check === 'model') {
    const model = aiProviderStatus()
    const simulated = process.env.RESEARCH_TEST_MODE === '1'
    const recipient = simulated ? 'Local test model' : model ? `${model.provider} · ${model.model}` : null
    return Response.json({ recipient: recipient?.slice(0, 300) ?? null, localOnly: simulated },
      { headers: { 'Cache-Control': 'no-store' } })
  }
  const cachedOnly = process.env.TECTONIC_ONLY_CACHED === '1'
  if (check === 'prepare' || check === 'preparation') {
    if (check === 'prepare' && preparation.state !== 'running') {
      if (cachedOnly || process.env.LATEX_COMPILE_ENABLED !== '1') {
        return Response.json({ error: 'Enable local compilation and allow resource downloads before preparing TeX.' }, { status: 409 })
      }
      const release = claimLocalCompiler('resources')
      if (!release) return Response.json({ error: 'Wait for the current compile to finish and retry.' }, { status: 409 })
      preparation = { state: 'running', startedAt: Date.now() }
      void prepareResources(release)
    }
    return Response.json(preparation, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (preparation.state === 'running') return Response.json({
    compiler: 'resources', cachedOnly, model: aiProviderStatus() ?? null, preparation,
  } satisfies WorkbenchStatus, { headers: { 'Cache-Control': 'no-store' } })
  pending ??= checkCompiler().finally(() => { pending = undefined })
  const status: WorkbenchStatus = { compiler: await pending, cachedOnly, model: aiProviderStatus() ?? null, preparation }
  return Response.json(status, { headers: { 'Cache-Control': 'no-store' } })
}
