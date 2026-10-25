import { defineConfig } from '@playwright/test'
import process from 'node:process'
import { URL, fileURLToPath } from 'node:url'
import { assertLocalSupabaseUrl } from './e2e/local-supabase.mjs'

const frontendDir = fileURLToPath(new URL('./', import.meta.url))
assertLocalSupabaseUrl(process.env.VITE_SUPABASE_URL)
const baseURL = 'http://127.0.0.1:4173'
const isCI = process.env.CI === 'true'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite --config e2e/vite.config.mjs --host 127.0.0.1 --port 4173 --strictPort',
    cwd: frontendDir,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
