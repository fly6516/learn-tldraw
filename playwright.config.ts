import { defineConfig, devices } from '@playwright/test'

const server = 'http://127.0.0.1:3177'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  timeout: 75_000,
  expect: { timeout: 12_000 },
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: server, trace: 'retain-on-failure' },
  webServer: {
    command: 'bun run start --hostname 127.0.0.1 --port 3177',
    url: server + '/research-test',
    env: { RESEARCH_TEST_MODE: '1', LATEX_COMPILE_ENABLED: '1', DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '', NEXT_TELEMETRY_DISABLED: '1' },
    timeout: 60_000,
  },
})
