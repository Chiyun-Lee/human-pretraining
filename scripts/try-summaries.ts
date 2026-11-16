// Runs the real summarising prompts on a local PDF and prints what Claude
// returns, for judging and tuning them without the app. Uses your own key:
//   echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local
//   node --env-file=.env.local scripts/try-summaries.ts paper.pdf [pages, default 4]
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { detectBlocks, type TextBox } from '../src/pdf/blocks.ts'
import { buildRegions, type PageBlock, uncovered } from '../src/summaries/regions.ts'
import { makeSlide } from '../supabase/functions/slide/claude.ts'
import { summariseBlocks } from '../supabase/functions/summarise/claude.ts'

const [file, pagesArg = '4'] = process.argv.slice(2)
const apiKey = process.env.ANTHROPIC_API_KEY
if (!file || !apiKey) {
  console.error('usage: node --env-file=.env.local scripts/try-summaries.ts paper.pdf [pages]')
  process.exit(1)
}

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise
const pages: PageBlock[][] = []
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n)
  const viewport = page.getViewport({ scale: 1 })
  const boxes: TextBox[] = []
  for (const item of (await page.getTextContent()).items) {
    if (!('str' in item) || item.str.trim() === '') continue
    const [a, b, c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform) as number[]
    if (Math.abs(b!) > 0.05 * Math.abs(a!)) continue
    boxes.push({ str: item.str, x: x!, baseline: y!, width: item.width, size: Math.hypot(c!, d!), font: item.fontName })
  }
  pages.push(detectBlocks(boxes, viewport.width).map((block) => ({ ...block, page: n, id: `p${n}b${block.index}` })))
}

const text = pages.flat().filter((b) => b.kind === 'paragraph').map((b) => b.text).join('\n\n').slice(0, 150_000)
const front = pages[0]!.map((b) => b.text).join('\n').slice(0, 4000)

console.log('Reading the whole paper…')
const read = await makeSlide(apiKey, file, text, front)
console.log('\n=== META ===\n', read.meta)
console.log('\n=== BRIEF ===\n', read.brief)
console.log('\n=== SLIDE ===\n', read.slide)

const count = Math.min(Number(pagesArg), pages.length)
for (let start = 0; start < count; start += 3) {
  const blocks = pages.slice(start, Math.min(start + 3, count)).flat()
  const payload = blocks.map((b) => ({
    id: b.id,
    kind: b.kind === 'paragraph' ? ('text' as const) : ('other' as const),
    column: b.column,
    text: b.kind === 'paragraph' ? b.text : b.text.slice(0, 200),
  }))
  const groups = await summariseBlocks(apiKey, read.brief, payload)
  const used = new Set<string>()
  const { regions, dropped } = buildRegions(groups, blocks, used)
  const prose = blocks.filter((b) => b.kind === 'paragraph')
  const words = (ids: string[]) => ids.reduce((sum, id) => sum + (blocks.find((b) => b.id === id)?.text.split(/\s+/).length ?? 0), 0)

  console.log(`\n=== PAGES ${start + 1}-${Math.min(start + 3, count)}: ${groups.length} groups, ${dropped} could not be drawn, ` +
    `${uncovered(blocks, used).length} of ${prose.length} paragraphs uncovered ===`)
  for (const group of groups) {
    const source = words(group.blocks)
    const summary = group.bullets.join(' ').split(/\s+/).length
    console.log(`\n[${group.kind}] ${group.blocks.join(',')}  (${source} words -> ${summary})`)
    for (const bullet of group.bullets) console.log(`  - ${bullet}`)
    if (group.caveat) console.log(`  ! ${group.caveat}`)
  }
  void regions
}
