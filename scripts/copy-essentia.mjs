import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'node_modules/essentia.js/dist')
const destDir = join(root, 'public/vendor/essentia')

const files = ['essentia-wasm.umd.js', 'essentia.js-extractor.umd.js']

mkdirSync(destDir, { recursive: true })

for (const file of files) {
  copyFileSync(join(srcDir, file), join(destDir, file))
}

console.log('[copy-essentia] copied Essentia worker assets to public/vendor/essentia')
