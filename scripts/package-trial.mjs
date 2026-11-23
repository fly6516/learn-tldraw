import { spawnSync } from 'node:child_process'
import { access, chmod, copyFile, cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const tectonic = process.argv[2] && resolve(process.argv[2])
if (!tectonic) throw new Error('Usage: node scripts/package-trial.mjs /path/to/tectonic [Tectonic notice file]')
if (Number(process.versions.node.split('.')[0]) !== 24 || process.versions.bun) throw new Error('Build the trial using Node.js 24.')
if ((await readdir(root)).some(name => name.startsWith('.env') && name !== '.env.example')) {
  throw new Error('Build from a clean checkout without local environment files.')
}
const probe = spawnSync(tectonic, ['--version'], { encoding: 'utf8' })
if (probe.status !== 0 || !probe.stdout.includes('Tectonic')) throw new Error('Supply a working Tectonic executable for this operating system.')
const next = join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
const win = process.platform === 'win32'
const build = spawnSync(process.execPath, [next, 'build'], {
  cwd: root,
  env: Object.fromEntries(Object.entries({ ...process.env, RESEARCH_TRIAL_BUILD: '1', NEXT_TELEMETRY_DISABLED: '1' })
    .filter(([name]) => !/^(NEXT_PUBLIC_|DEEPSEEK_|OPENAI_|RESEARCH_TEST_MODE)/i.test(name))),
  stdio: 'inherit',
})
if (build.error || build.status !== 0) throw build.error ?? new Error('The trial build failed.')

const output = join(root, 'build')
await mkdir(output, { recursive: true })
const target = await mkdtemp(join(output, `research-canvas-${process.platform}-${process.arch}-`))
const app = join(target, 'app')
const nextOutput = join(root, '.next')
await access(join(nextOutput, 'standalone', 'server.js'))
await cp(join(nextOutput, 'standalone'), app, { recursive: true })
await cp(join(nextOutput, 'static'), join(app, '.next', 'static'), { recursive: true })
await cp(join(root, 'public'), join(app, 'public'), { recursive: true })
const runtime = join(target, 'runtime')
await mkdir(runtime)
const nodeName = win ? 'node.exe' : 'node'
const compilerName = win ? 'tectonic.exe' : 'tectonic'
for (const [source, name] of [[process.execPath, nodeName], [tectonic, compilerName]]) {
  await copyFile(source, join(runtime, name))
  if (!win) await chmod(join(runtime, name), 0o755)
}
const nodeNotice = [join(dirname(process.execPath), 'LICENSE'), join(dirname(process.execPath), '..', 'LICENSE'),
  join(dirname(process.execPath), '..', 'share', 'doc', 'nodejs', 'copyright')].find(existsSync)
const notice = process.argv[3] && resolve(process.argv[3])
if (nodeNotice) await copyFile(nodeNotice, join(runtime, 'Node-NOTICE.txt'))
if (notice) await copyFile(notice, join(runtime, 'Tectonic-NOTICE.txt'))
if (!nodeNotice || !notice) console.warn('Retain the notices from the original runtime distributions before sharing this bundle.')
await copyFile(join(root, 'scripts', 'trial-launch.mjs'), join(target, 'launch.mjs'))
const start = join(target, win ? 'Start Research Canvas.cmd' : 'start-research-canvas.sh')
await writeFile(start, win
  ? '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0launch.mjs"\r\nif errorlevel 1 pause\r\n'
  : '#!/bin/sh\nset -eu\nbundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$bundle/runtime/node" "$bundle/launch.mjs"\n')
if (!win) await chmod(start, 0o755)
const instructions = await readFile(join(root, 'docs', 'trial-quickstart.txt'), 'utf8')
await writeFile(join(target, 'START HERE.txt'), instructions)
console.log(`Trial folder: ${target} (start with ${basename(start)})`)
