import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeConfig } from 'vite'
import frontendConfig from '../vite.config.ts'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default mergeConfig(frontendConfig, {
  envDir: path.resolve(frontendRoot, '..', '.e2e-supabase', 'vite-env'),
})
