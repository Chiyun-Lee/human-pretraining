// Copies the PDF.js runtime assets (character maps, fallback fonts, image
// decoders) into public/ so the app can serve them from its own origin.
import { cpSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules', 'pdfjs-dist')
const to = join(root, 'public', 'pdfjs')

rmSync(to, { recursive: true, force: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(join(from, dir), join(to, dir), { recursive: true })
}
