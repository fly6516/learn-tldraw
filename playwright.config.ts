import { defineConfig, devices } from '@playwright/test'

const livePath = process.env.RESEARCH_LIVE_TEST_PATH
  || (process.env.RESEARCH_LIVE_TEST === '1' || process.env.RESEARCH_LIVE_TEST_ZIP ? '/research' : undefined)
const keylessSample = process.env.RESEARCH_SAMPLE_NO_KEY === '1'
const trialUrl = process.env.RESEARCH_TRIAL_E2E_URL
const attachmentAcceptance = process.env.RESEARCH_ATTACHMENT_ACCEPTANCE === '1'
if (trialUrl && !/^http:\/\/127\.0\.0\.1:\d+$/.test(trialUrl)) throw new Error('Use a loopback HTTP address for the trial tests.')
const port = attachmentAcceptance ? 3182 : livePath ? 3178 : 3177
const server = trialUrl ?? `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: livePath ? 'test-results-live' : 'test-results',
  fullyParallel: true,
  // The local LaTeX service allows one compile at a time.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 75_000,
  expect: { timeout: 12_000 },
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: server, trace: 'retain-on-failure' },
  webServer: trialUrl ? undefined : {
    command: `bun run start --hostname 127.0.0.1 --port ${port}`,
    url: server + (attachmentAcceptance ? '/research' : livePath ?? (keylessSample ? '/research' : '/research-test')),
    env: { RESEARCH_TEST_MODE: attachmentAcceptance || livePath || keylessSample ? '0' : '1', LATEX_COMPILE_ENABLED: process.env.RESEARCH_SETUP_COMPILE ?? '1', NEXT_TELEMETRY_DISABLED: '1',
      ...(livePath ? {} : { DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '' }) },
    timeout: 60_000,
  },
})
