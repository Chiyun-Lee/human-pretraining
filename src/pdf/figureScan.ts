// Scans a document for figures and tables: each caption, and where its
// picture sits (see figures.ts). Needs a canvas, so it only runs in the browser.
import { detectBlocks } from './blocks'
import { type Box, figureBox, type InkMask, isCaption } from './figures'
import { pageTextBoxes, type PdfDocument, type PdfPage } from './pdfjs'

export interface Figure {
  /** Identifier sent to Claude, such as "fig3_7". */
  id: string
  page: number
  /** Id of the caption's text block, as used for summaries ("p3b7"). */
  captionBlockId: string
  caption: string
  /** Where the picture is, in page units; null when it could not be found. */
  box: Box | null
}

async function inkMask(page: PdfPage): Promise<InkMask> {
  const viewport = page.getViewport({ scale: 1 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  await page.render({ canvas, canvasContext: context, viewport }).promise
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const data = new Uint8Array(canvas.width * canvas.height)
  for (let i = 0; i < data.length; i++) {
    // Anything clearly darker than paper counts as drawn.
    if (pixels[i * 4]! + pixels[i * 4 + 1]! + pixels[i * 4 + 2]! < 3 * 235) data[i] = 1
  }
  return { data, width: canvas.width, height: canvas.height, scale: 1 }
}

const scans = new WeakMap<PdfDocument, Promise<Figure[]>>()

/** Every figure and table in the document. Scanned once per open document. */
export function findFigures(doc: PdfDocument): Promise<Figure[]> {
  let scan = scans.get(doc)
  if (!scan) {
    scan = (async () => {
      const figures: Figure[] = []
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber)
        const { width } = page.getViewport({ scale: 1 })
        const blocks = detectBlocks(await pageTextBoxes(page), width)
        const captions = blocks.filter(isCaption)
        if (captions.length === 0) continue
        const mask = await inkMask(page)
        for (const caption of captions) {
          figures.push({
            id: `fig${pageNumber}_${caption.index}`,
            page: pageNumber,
            captionBlockId: `p${pageNumber}b${caption.index}`,
            caption: caption.text,
            box: figureBox(mask, blocks, caption, width),
          })
        }
      }
      return figures
    })()
    scans.set(doc, scan)
  }
  return scan
}

/** A figure's picture cut out of its page, as a PNG data URL. */
export async function cropFigure(doc: PdfDocument, pageNumber: number, box: Box, targetWidth = 1000): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const scale = Math.min(4, targetWidth / (box.x1 - box.x0))
  const viewport = page.getViewport({ scale })
  const full = document.createElement('canvas')
  full.width = Math.ceil(viewport.width)
  full.height = Math.ceil(viewport.height)
  await page.render({ canvas: full, canvasContext: full.getContext('2d')!, viewport }).promise

  const crop = document.createElement('canvas')
  crop.width = Math.round((box.x1 - box.x0) * scale)
  crop.height = Math.round((box.y1 - box.y0) * scale)
  crop.getContext('2d')!.drawImage(full, -Math.round(box.x0 * scale), -Math.round(box.y0 * scale))
  return crop.toDataURL('image/png')
}
