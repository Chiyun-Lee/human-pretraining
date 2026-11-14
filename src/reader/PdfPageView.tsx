import { useEffect, useRef, useState } from 'react'
import { detectBlocks, type Block } from '../pdf/blocks'
import { type Figure, findFigures } from '../pdf/figureScan'
import { pageTextBoxes, type PdfDocument } from '../pdf/pdfjs'
import type { Region } from '../summaries/regions'
import { BlockOverlay } from './BlockOverlay'

interface Props {
  doc: PdfDocument
  pageNumber: number
  /** Width / height used for the placeholder before the page has loaded. */
  defaultAspect: number
  /** AI summaries for this page. */
  regions: Region[]
  summarise: boolean
  /** Debug view: outline every detected text block. */
  showBlocks: boolean
  /** Changes whenever the reader-wide switch is used, to reset per-block switches. */
  resetKey: number
}

interface PageLayout {
  width: number
  height: number
  blocks: Block[]
}

// Keeps canvases within mobile browser memory limits.
const MAX_CANVAS_PIXELS = 8_000_000

export function PdfPageView({ doc, pageNumber, defaultAspect, regions, summarise, showBlocks, resetKey }: Props) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasHolderRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [cssWidth, setCssWidth] = useState(0)
  const [layout, setLayout] = useState<PageLayout | null>(null)
  const [figures, setFigures] = useState<Figure[]>([])

  // Only pages near the viewport are rendered.
  useEffect(() => {
    const frame = frameRef.current!
    const visibility = new IntersectionObserver(([entry]) => setNear(entry!.isIntersecting), {
      rootMargin: '800px 0px',
    })
    const size = new ResizeObserver(([entry]) => setCssWidth(Math.round(entry!.contentRect.width)))
    visibility.observe(frame)
    size.observe(frame)
    return () => {
      visibility.disconnect()
      size.disconnect()
    }
  }, [])

  // Debug view only: where figures were found.
  useEffect(() => {
    if (!showBlocks) return
    let cancelled = false
    void findFigures(doc).then((all) => !cancelled && setFigures(all.filter((figure) => figure.page === pageNumber)))
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, showBlocks])

  // Text layout is computed once per page and kept.
  useEffect(() => {
    if (!near || layout) return
    let cancelled = false
    void (async () => {
      const page = await doc.getPage(pageNumber)
      const { width, height } = page.getViewport({ scale: 1 })
      const blocks = detectBlocks(await pageTextBoxes(page), width)
      if (!cancelled) setLayout({ width, height, blocks })
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, near, layout])

  useEffect(() => {
    const holder = canvasHolderRef.current!
    if (!near || cssWidth === 0) {
      holder.replaceChildren()
      return
    }
    let cancelled = false
    let cancelRender: (() => void) | undefined
    void (async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const wanted = (cssWidth * window.devicePixelRatio) / base.width
      const limit = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height))
      const viewport = page.getViewport({ scale: Math.min(wanted, limit) })

      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport })
      cancelRender = () => task.cancel()
      try {
        await task.promise
        if (!cancelled) holder.replaceChildren(canvas)
      } catch (error) {
        if ((error as Error).name !== 'RenderingCancelledException') throw error
      }
    })()
    return () => {
      cancelled = true
      cancelRender?.()
    }
  }, [doc, pageNumber, near, cssWidth])

  const aspect = layout ? layout.width / layout.height : defaultAspect

  return (
    <div ref={frameRef} className="page" style={{ aspectRatio: String(aspect) }} data-page={pageNumber}>
      <div ref={canvasHolderRef} className="page-canvas" />
      {near &&
        layout &&
        regions.map((region, i) => (
          <BlockOverlay
            key={`${resetKey}-${i}`}
            region={region}
            pageWidth={layout.width}
            pageHeight={layout.height}
            summariseByDefault={summarise}
          />
        ))}
      {near &&
        showBlocks &&
        layout?.blocks.map((block) => (
          <div
            key={block.index}
            className={block.kind === 'paragraph' ? 'block block-outline' : 'block block-outline block-other'}
            style={{
              left: `${(block.x0 / layout.width) * 100}%`,
              top: `${(block.y0 / layout.height) * 100}%`,
              width: `${((block.x1 - block.x0) / layout.width) * 100}%`,
              height: `${((block.y1 - block.y0) / layout.height) * 100}%`,
            }}
          />
        ))}
      {near &&
        showBlocks &&
        layout &&
        figures.map(
          (figure) =>
            figure.box && (
              <div
                key={figure.id}
                className="block block-outline block-figure-outline"
                style={{
                  left: `${(figure.box.x0 / layout.width) * 100}%`,
                  top: `${(figure.box.y0 / layout.height) * 100}%`,
                  width: `${((figure.box.x1 - figure.box.x0) / layout.width) * 100}%`,
                  height: `${((figure.box.y1 - figure.box.y0) / layout.height) * 100}%`,
                }}
              />
            ),
        )}
    </div>
  )
}
