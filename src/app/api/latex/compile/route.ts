import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { importSourceArchive, isProjectPath } from '@/lib/project/source-archive'
import { parseCompileDiagnostics } from '@/lib/project/compile-diagnostics'

export const runtime = 'nodejs'

const exec = promisify(execFile)
const maxBytes = 32 * 1024 * 1024
let compiling = false

export async function POST(request: Request) {
  if (process.env.LATEX_COMPILE_ENABLED !== '1') {
    return Response.json({ error: 'Set LATEX_COMPILE_ENABLED=1 on the local server to enable Tectonic.' }, { status: 503 })
  }
  const host = request.headers.get('host') ?? ''
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    || request.headers.get('origin') !== `http://${host}`) {
    return Response.json({ error: 'The native compiler is available from the local workbench only.' }, { status: 403 })
  }
  const mainFile = new URL(request.url).searchParams.get('main') ?? ''
  if (!isProjectPath(mainFile) || !/\.tex$/i.test(mainFile)) {
    return Response.json({ error: 'Select a valid .tex main file.' }, { status: 400 })
  }
  const length = Number(request.headers.get('content-length'))
  if (!Number.isSafeInteger(length) || length < 1 || length > maxBytes) {
    return Response.json({ error: 'The compile request must be a ZIP of at most 32 MB.' }, { status: 413 })
  }
  if (compiling) return Response.json({ error: 'Another compile is in progress.' }, { status: 429 })
  compiling = true
  let work: string | undefined
  try {
    let project
    try {
      project = await importSourceArchive(new File([await request.arrayBuffer()], 'compile.zip'), maxBytes)
    } catch (cause) {
      return Response.json({ error: cause instanceof Error ? cause.message : 'Invalid project ZIP.' }, { status: 400 })
    }
    const main = project.files.get(mainFile)
    if (!main || main.type === 'directory') {
      return Response.json({ error: 'The selected main file is missing from the project.' }, { status: 400 })
    }

    work = await mkdtemp(join(tmpdir(), 'research-latex-'))
    const sources = join(work, 'sources')
    const output = join(work, 'output')
    await mkdir(output)
    for (const entry of project.files.values()) {
      const path = join(sources, entry.path)
      if (entry.type === 'directory') {
        await mkdir(path, { recursive: true })
      } else if ('blob' in entry && entry.blob) {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, new Uint8Array(await entry.blob.arrayBuffer()), { flag: 'wx' })
      }
    }

    try {
      await exec(process.env.TECTONIC_BIN || 'tectonic', [
        '--untrusted', '--keep-logs',
        ...(process.env.TECTONIC_ONLY_CACHED === '1' ? ['--only-cached'] : []),
        '--outdir', output, '--', basename(mainFile),
      ], {
        cwd: dirname(join(sources, mainFile)), windowsHide: true,
        timeout: 120_000, maxBuffer: 2 * 1024 * 1024, signal: request.signal,
      })
    } catch (cause) {
      const failure = cause as NodeJS.ErrnoException & { killed?: boolean; stderr?: string; stdout?: string }
      const error = failure.code === 'ENOENT'
        ? 'Tectonic executable not found. Install it or set TECTONIC_BIN.'
        : failure.killed ? 'LaTeX compilation timed out.' : 'LaTeX compilation failed.'
      const log = await readFile(join(output, basename(mainFile).replace(/\.tex$/i, '.log')), 'utf8').catch(() => '')
      const outputText = [failure.stderr, failure.stdout].filter(Boolean).join('\n')
      return Response.json({
        error,
        diagnostics: parseCompileDiagnostics(outputText, mainFile, project.files.keys()),
        log: (outputText + (log ? '\n\n' + log : '')).slice(-50_000),
      }, { status: 422 })
    }
    const pdf = await readFile(join(output, basename(mainFile).replace(/\.tex$/i, '.pdf')))
    return new Response(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
    })
  } catch (cause) {
    console.error('Could not compile the LaTeX project:', cause)
    return Response.json({ error: 'Could not prepare the project or read the compiled PDF.' }, { status: 500 })
  } finally {
    try {
      if (work) await rm(work, { recursive: true, force: true })
    } finally {
      compiling = false
    }
  }
}
