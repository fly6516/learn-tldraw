import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.env.RESEARCH_TRIAL_PORT || 3000)
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Set RESEARCH_TRIAL_PORT to a port between 1024 and 65535.')
  process.exit(1)
}

const url = `http://127.0.0.1:${port}/research`
const win = process.platform === 'win32'
const server = spawn(process.execPath, [join(root, 'app', 'server.js')], {
  cwd: join(root, 'app'),
  env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1',
    LATEX_COMPILE_ENABLED: '1', RESEARCH_TEST_MODE: '0', TECTONIC_BIN: join(root, 'runtime', win ? 'tectonic.exe' : 'tectonic'),
    DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
})

const stopped = new AbortController()
const stop = () => server.kill()
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
server.on('error', error => { console.error(error.message); process.exitCode = 1; stopped.abort() })
server.on('exit', code => { process.exitCode = code ?? 0; stopped.abort() })

async function openWhenReady() {
  for (let attempt = 0; attempt < 50 && !stopped.signal.aborted; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.any([stopped.signal, AbortSignal.timeout(1000)]) }).catch(() => null)
    if (response?.ok) {
      console.log(`Open ${url} in your browser. Keep this window open while you work.`)
      if (process.env.RESEARCH_TRIAL_NO_BROWSER !== '1') {
        const command = win ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
        const browser = spawn(command, [url], { stdio: 'ignore', detached: true })
        browser.on('error', () => console.log(`Open ${url} manually.`))
        browser.unref()
      }
      return
    }
    await delay(200)
  }
  if (!stopped.signal.aborted) console.log(`The workbench took longer to start. Check this window, then open ${url}.`)
}

let opening = false
let startup = ''
server.stdout.on('data', output => {
  process.stdout.write(output)
  if (opening) return
  startup = (startup + output.toString()).slice(-512)
  if (startup.includes(`127.0.0.1:${port}`)) {
    opening = true
    void openWhenReady()
  }
})
