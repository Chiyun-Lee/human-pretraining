// Single place that configures PDF.js. The legacy build is used so the reader
// also runs on older mobile browsers.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { TextBox } from './blocks'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type PdfDocument = pdfjs.PDFDocumentProxy
export type PdfPage = pdfjs.PDFPageProxy

const assets = new URL('pdfjs/', document.baseURI).href

export function openPdf(source: ArrayBuffer | string): Promise<PdfDocument> {
  return pdfjs.getDocument({
    ...(typeof source === 'string' ? { url: source } : { data: source }),
    cMapUrl: assets + 'cmaps/',
    standardFontDataUrl: assets + 'standard_fonts/',
    wasmUrl: assets + 'wasm/',
    iccUrl: assets + 'iccs/',
  }).promise
}

/** Text fragments of a page in top-down page units, ready for block detection. */
export async function pageTextBoxes(page: PdfPage): Promise<TextBox[]> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const boxes: TextBox[] = []

  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue
    const [a, b, c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform) as number[]
    // Skip rotated text such as the arXiv stamp in the margin.
    if (Math.abs(b!) > 0.05 * Math.abs(a!)) continue
    boxes.push({
      str: item.str,
      x: x!,
      baseline: y!,
      width: item.width,
      size: Math.hypot(c!, d!),
      font: item.fontName,
    })
  }
  return boxes
}

/**
 * Fills `container` with the page's text as invisible, selectable spans that
 * sit exactly over the rendered page. It scales with the CSS variable
 * --total-scale-factor (CSS pixels per page unit) set on an ancestor.
 */
export async function renderTextLayer(page: PdfPage, container: HTMLElement): Promise<void> {
  container.replaceChildren()
  const layer = new pdfjs.TextLayer({
    textContentSource: await page.getTextContent(),
    container,
    viewport: page.getViewport({ scale: 1 }),
  })
  await layer.render()
}
