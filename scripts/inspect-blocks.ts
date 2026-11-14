// Prints the blocks detected on each page of a PDF, for tuning the detector.
// Usage: node scripts/inspect-blocks.ts paper.pdf [page]
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { detectBlocks, type TextBox } from '../src/pdf/blocks.ts'

const [file, onlyPage] = process.argv.slice(2)
if (!file) {
  console.error('usage: node scripts/inspect-blocks.ts paper.pdf [page]')
  process.exit(1)
}

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)) }).promise
for (let n = 1; n <= doc.numPages; n++) {
  if (onlyPage && Number(onlyPage) !== n) continue
  const page = await doc.getPage(n)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const boxes: TextBox[] = []
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue
    const [a, b, c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform) as number[]
    if (Math.abs(b!) > 0.05 * Math.abs(a!)) continue
    boxes.push({ str: item.str, x: x!, baseline: y!, width: item.width, size: Math.hypot(c!, d!), font: item.fontName })
  }
  const blocks = detectBlocks(boxes, viewport.width)
  const paragraphs = blocks.filter((b) => b.kind === 'paragraph')
  console.log(`\n== page ${n}: ${blocks.length} blocks, ${paragraphs.length} paragraphs (${viewport.width}x${viewport.height})`)
  for (const b of blocks) {
    const mark = b.kind === 'paragraph' ? 'P' : '.'
    const box = [b.x0, b.y0, b.x1, b.y1].map((v) => v.toFixed(0)).join(',')
    console.log(`${mark} ${b.column.padEnd(5)} [${box}] ${b.lineCount}L  ${b.text.slice(0, 70)}`)
  }
}
