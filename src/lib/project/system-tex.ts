import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, delimiter, dirname, join, posix } from 'node:path'
import { promisify } from 'node:util'
import type { CompileProfile } from './compile-profile'
import { isProjectPath } from './source-archive'

const exec = promisify(execFile)

export function systemCompilerUnavailable(profile: CompileProfile) {
  if (profile.engine === 'tectonic') return
  if (profile.engine === 'lualatex') return 'This profile uses external LuaLaTeX. Use the external build ZIP in Prepare submission.'
  if (process.env.LATEX_SYSTEM_TEX_ENABLED !== '1') {
    return 'This profile needs an enabled local TeX Live installation. Open Compile settings or use the external build ZIP.'
  }
}

export function checkBiberSources(control: string, main: string, paths: ReadonlySet<string>) {
  if (/<!DOCTYPE|<!ENTITY|<xi:include\b/i.test(control)) throw new Error('Unsupported XML in the Biber control file.')
  const root = main.slice(0, main.lastIndexOf('/') + 1)
  for (const item of control.matchAll(/<bcf:datasource\b([^>]*)>([^<]*)<\/bcf:datasource>/g)) {
    const file = item[2].trim().replace(/^\.\/+/, '')
    if (/\blocation\s*=\s*["']remote["']/i.test(item[1]) || !/\.bib$/i.test(file)
      || !isProjectPath(file) || !paths.has(root + file)) {
      throw new Error('Biber requires project-relative .bib files included in this ZIP. Review the bibliography resources or use the external build ZIP.')
    }
  }
}

export async function runSystemTex(profile: Exclude<CompileProfile, { engine: 'tectonic' }>,
  project: { main: string; sourceRoot: string; output: string; paths: ReadonlySet<string> }, synchronize: boolean, signal: AbortSignal) {
  const main = basename(project.main)
  const job = main.slice(0, -4)
  const output = basename(project.output)
  const cwd = dirname(join(project.sourceRoot, project.main))
  const distribution = process.platform === 'win32' ? process.env.LATEX_SYSTEM_TEX_WSL : undefined
  const deadline = AbortSignal.timeout(120_000)
  const options = { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024, signal: AbortSignal.any([signal, deadline]) }
  const limits = { openin_any: 'p', openout_any: 'p', shell_escape: 'f' }
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|LANG|LC_[A-Z_]+)$/i.test(name)))
  const env = { ...inherited, ...limits, NODE_ENV: process.env.NODE_ENV, BSTINPUTS: `.${delimiter}.//${delimiter}`, BIBINPUTS: `.${delimiter}.//${delimiter}` }
  const wslSourceRoot = distribution && (await exec('wsl.exe', ['-d', distribution, '--exec', 'wslpath', '-a',
    project.sourceRoot.replace(/\\/g, '/')], options)).stdout.trim()
  const wslCwd = wslSourceRoot && posix.dirname(posix.join(wslSourceRoot, project.main))
  let consoleLog = ''
  async function run(command: string, args: string[]) {
    try {
      const result = distribution && wslCwd ? await exec('wsl.exe', ['-d', distribution, '--cd', wslCwd, '--exec', 'env',
        ...Object.entries({ ...limits, BSTINPUTS: '.:.//:', BIBINPUTS: '.:.//:' }).map(([name, value]) => name + '=' + value), command, ...args], options)
        : await exec(command, args, { ...options, env })
      consoleLog = [consoleLog, result.stdout, result.stderr].filter(Boolean).join('\n').slice(-90_000)
    } catch (cause) {
      const failure = cause as NodeJS.ErrnoException & { stderr?: string; stdout?: string; killed?: boolean }
      const missing = failure.code === 'ENOENT' || /(?:command not found|execvpe\(.+\) failed: No such file)/i.test(failure.stderr ?? '')
      const message = missing ? `${command} is missing from the configured local TeX installation.`
        : deadline.aborted || failure.killed ? 'Local TeX compilation timed out.'
          : `${command} failed. See the compiler log for details.`
      throw Object.assign(new Error(message), { stdout: [consoleLog, failure.stdout].filter(Boolean).join('\n'), stderr: failure.stderr })
    }
  }
  const args = ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-no-shell-escape', '-no-parse-first-line',
    ...(synchronize ? ['-synctex=1'] : []), `-output-directory=${output}`, `./${main}`]
  await run(profile.engine, args)

  const control = await readFile(join(project.output, job + '.bcf'), 'utf8').catch(() => '')
  const aux = await readFile(join(project.output, job + '.aux'), 'utf8').catch(() => '')
  const bibliography = profile.bibliography === 'auto' ? control ? 'biber' : /\\bibdata\s*\{/.test(aux) ? 'bibtex' : 'none' : profile.bibliography
  if (bibliography === 'biber') {
    if (!control) throw new Error('Biber is selected, but the compile entry did not create a Biber control file.')
    checkBiberSources(control, project.main, project.paths)
    await run('biber', ['--noconf', '--output-directory', output, `./${output}/${job}.bcf`])
  } else if (bibliography === 'bibtex') {
    if (!/\\bibdata\s*\{/.test(aux)) throw new Error('BibTeX is selected, but the compile entry did not declare a BibTeX bibliography.')
    await run('bibtex', [`./${output}/${job}`])
  }
  await run(profile.engine, args)
  if (bibliography !== 'none') await run(profile.engine, args)
  return { log: consoleLog, syncRoot: wslSourceRoot || project.sourceRoot }
}
