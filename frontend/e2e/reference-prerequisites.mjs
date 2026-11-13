import { access } from 'node:fs/promises'
import path from 'node:path'

// Optional comparison tooling only; never loaded by the app or normal CI.
export async function assertReferencePrerequisites(referenceRoot) {
  const required = [
    'index.html',
    'node_modules/vite/dist/node/index.js',
    'node_modules/@vitejs/plugin-react/dist/index.js',
    'node_modules/@tailwindcss/vite/dist/index.mjs',
  ]
  for (const file of required) {
    try {
      await access(path.join(referenceRoot, file))
    } catch {
      throw new Error(`Figma comparison requires the sibling ../figma-make-reference checkout at ${referenceRoot}. Missing: ${file}. Restore the reference app and run pnpm install in that directory (Vite, @vitejs/plugin-react and @tailwindcss/vite are required).`)
    }
  }
}
