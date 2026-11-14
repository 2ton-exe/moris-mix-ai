import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { assertReferencePrerequisites } from './reference-prerequisites.mjs'

test('reference prerequisite errors identify the checkout or each missing dependency', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moris-reference-check-'))
  try {
    const files = ['index.html', 'node_modules/vite/dist/node/index.js', 'node_modules/@vitejs/plugin-react/dist/index.js', 'node_modules/@tailwindcss/vite/dist/index.mjs']
    for (const file of files) {
      await assert.rejects(assertReferencePrerequisites(root), (error) => {
        assert.ok(error.message.includes(root))
        assert.ok(error.message.includes(`Missing: ${file}`))
        assert.match(error.message, /pnpm install/)
        return true
      })
      await mkdir(path.dirname(path.join(root, file)), { recursive: true })
      await writeFile(path.join(root, file), '')
    }
    await assertReferencePrerequisites(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
