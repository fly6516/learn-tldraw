import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'
import { importSourceArchive, isProjectPath } from '@/lib/project/source-archive'
import { compileFailureMessage, compileLog, parseCompileDiagnostics, type CompileReport } from '@/lib/project/compile-diagnostics'
import { readSyncTex } from '@/lib/project/read-synctex'

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
  const params = new URL(request.url).searchParams
  const mainFile = params.get('main') ?? ''
  const synchronize = params.get('sync') === '1'
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

    const job = basename(mainFile).replace(/\.tex$/i, '')
    const readLog = () => readFile(join(output, job + '.log'), 'utf8').catch(() => '')
    const onlyCached = process.env.TECTONIC_ONLY_CACHED === '1'
    const timeout = process.env.RESEARCH_TRIAL_RUNTIME === '1' && !onlyCached ? 360_000 : 120_000
    let outputText: string
    try {
      const { stdout, stderr } = await exec(process.env.TECTONIC_BIN || 'tectonic', [
        '--untrusted', '--keep-logs',
        ...(synchronize ? ['--synctex'] : []),
        ...(onlyCached ? ['--only-cached'] : []),
        '--outdir', output, '--', basename(mainFile),
      ], {
        cwd: dirname(join(sources, mainFile)), windowsHide: true,
        timeout, maxBuffer: 2 * 1024 * 1024, signal: request.signal,
      })
      outputText = [stderr, stdout].filter(Boolean).join('\n')
    } catch (cause) {
      const failure = cause as NodeJS.ErrnoException & { killed?: boolean; stderr?: string; stdout?: string }
      const outputText = [failure.stderr, failure.stdout].filter(Boolean).join('\n')
      const error = failure.code === 'ENOENT'
        ? 'Tectonic executable not found. Install it or set TECTONIC_BIN.'
        : failure.killed ? 'LaTeX compilation timed out.' : compileFailureMessage(outputText, onlyCached)
      const log = await readLog()
      return Response.json({
        error,
        diagnostics: parseCompileDiagnostics(outputText, mainFile, project.files.keys()),
        log: compileLog(outputText, log, 50_000),
      }, { status: 422 })
    }
    const pdf = new Uint8Array(await readFile(join(output, job + '.pdf')))
    if (synchronize) {
      const mapPath = join(output, job + '.synctex.gz')
      const map = await stat(mapPath).then(async info => {
        if (info.size > maxBytes) return []
        const text = gunzipSync(await readFile(mapPath), { maxOutputLength: maxBytes }).toString()
        return readSyncTex(text, sources, mainFile, project.files.keys())
      }).catch(() => [])
      const result = new FormData()
      result.set('pdf', new Blob([pdf], { type: 'application/pdf' }), job + '.pdf')
      result.set('sourceMap', JSON.stringify(map))
      const log = await readLog()
      const diagnostics = parseCompileDiagnostics(outputText, mainFile, project.files.keys()).filter(issue => issue.severity === 'warning')
      const hasWarnings = /^warning:/mi.test(outputText) || /^(?:LaTeX|Package .+|Class .+) Warning:|^(?:Over|Under)full \\[hv]box/m.test(log)
      result.set('report', JSON.stringify({
        diagnostics, hasWarnings,
        log: [outputText, log].filter(Boolean).join('\n\n').slice(-50_000),
      } satisfies CompileReport))
      return new Response(result, { headers: { 'Cache-Control': 'no-store' } })
    }
    return new Response(pdf, {
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
