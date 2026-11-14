import { useEffect, useMemo, useRef, useState } from 'react'
import type { Reference } from '../library/bibliography'
import { detectBlocks, type Block, type TextBox } from '../pdf/blocks'
import type { Box } from '../pdf/figures'
import { locateQuote } from '../pdf/locate'
import { type Figure, findFigures } from '../pdf/figureScan'
import type { Annotation } from '../annotations/annotations'
import { pageTextBoxes, renderTextLayer, type PdfDocument } from '../pdf/pdfjs'
import type { Facet, Region } from '../summaries/regions'
import { BlockOverlay } from './BlockOverlay'
import type { Info } from './InfoCard'
import { findCitations, findTerms, type Term } from './marks'

interface Props {
  doc: PdfDocument
  pageNumber: number
  /** Width / height used for the placeholder before the page has loaded. */
  defaultAspect: number
  /** AI summaries for this page. */
  regions: Region[]
  /** The reader's highlights on this page. */
  annotations: Annotation[]
  /** A highlight was clicked, at this screen position. */
  onPickAnnotation: (annotation: Annotation, anchor: { x: number; y: number }) => void
  summarise: boolean
  /** Debug view: outline every detected text block. */
  showBlocks: boolean
  /** Changes whenever the reader-wide switch is used, to reset per-block switches. */
  resetKey: number
  /** Which kinds of source sentence are marked on original text. */
  facets: Set<Facet>
  /** The paper's defined terms and reference list, for the cards on terms and citations. */
  terms: Term[]
  refs: Reference[]
  onInfo: (info: Info, anchor: Point) => void
  onEditRegion: (region: Region, bullets: string[], caveat: string | null) => void
  /** The note Claude is being asked about, if it is on this page. */
  askingRegion: Region | null
  /** While set, dragging on the page marks out an area to ask about. */
  onPickArea?: (box: Box, anchor: Point) => void
}

type Point = { x: number; y: number }

interface PageLayout {
  width: number
  height: number
  blocks: Block[]
  boxes: TextBox[]
}

// Keeps canvases within mobile browser memory limits.
const MAX_CANVAS_PIXELS = 8_000_000

export function PdfPageView({
  doc,
  pageNumber,
  defaultAspect,
  regions,
  annotations,
  onPickAnnotation,
  summarise,
  showBlocks,
  resetKey,
  facets,
  terms,
  refs,
  onInfo,
  onEditRegion,
  askingRegion,
  onPickArea,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasHolderRef = useRef<HTMLDivElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
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

  // Invisible, selectable text over the page, so the reader can highlight it.
  useEffect(() => {
    const container = textLayerRef.current!
    if (!near) {
      container.replaceChildren()
      return
    }
    let cancelled = false
    void doc.getPage(pageNumber).then((page) => {
      if (!cancelled) void renderTextLayer(page, container)
    })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, near])

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
      const boxes = await pageTextBoxes(page)
      if (!cancelled) setLayout({ width, height, blocks: detectBlocks(boxes, width), boxes })
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

  // Where each note's source sentences are, looked for only inside the note's own rectangle.
  const boxes = layout?.boxes
  const sourceRects = useMemo(
    () =>
      regions.map((region) => {
        if (!boxes || !region.sources) return []
        const inside = boxes.filter((b) => b.x + b.width > region.x0 - 2 && b.x < region.x1 + 2 && b.baseline > region.y0 - 2 && b.baseline < region.y1 + 4)
        return region.sources.map((source) => (source.quote ? locateQuote(inside, source.quote) : []))
      }),
    [boxes, regions],
  )
  const citations = useMemo(() => (boxes ? findCitations(boxes, refs) : []), [boxes, refs])
  const termMarks = useMemo(() => (boxes ? findTerms(boxes, terms) : []), [boxes, terms])
  const place = (box: Box) =>
    layout && {
      left: `${(box.x0 / layout.width) * 100}%`,
      top: `${(box.y0 / layout.height) * 100}%`,
      width: `${((box.x1 - box.x0) / layout.width) * 100}%`,
      height: `${((box.y1 - box.y0) / layout.height) * 100}%`,
    }

  // Dragging out an area to ask about.
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null)
  const toPage = (event: { clientX: number; clientY: number }): Point => {
    const bounds = frameRef.current!.getBoundingClientRect()
    const scale = (layout?.width ?? 1) / bounds.width
    return { x: (event.clientX - bounds.left) * scale, y: (event.clientY - bounds.top) * scale }
  }
  const dragBox = drag && {
    x0: Math.min(drag.from.x, drag.to.x),
    y0: Math.min(drag.from.y, drag.to.y),
    x1: Math.max(drag.from.x, drag.to.x),
    y1: Math.max(drag.from.y, drag.to.y),
  }

  return (
    <div
      ref={frameRef}
      className="page"
      data-page={pageNumber}
      data-page-width={layout?.width}
      style={{
        aspectRatio: String(aspect),
        // CSS pixels per page unit: sizes the text layer.
        ['--total-scale-factor' as string]: layout && cssWidth ? cssWidth / layout.width : 1,
      }}
    >
      <div ref={canvasHolderRef} className="page-canvas" />
      <div ref={textLayerRef} className="textLayer" />
      {near &&
        layout &&
        annotations.flatMap((annotation) =>
          annotation.rects.map((rect, i) => (
            <button
              key={`${annotation.id}-${i}`}
              type="button"
              className={`highlight${annotation.note || annotation.thread.length > 0 ? ' has-note' : ''}${annotation.area ? ' area' : ''}`}
              aria-label={annotation.note ? `Note: ${annotation.note}` : annotation.thread.length > 0 ? 'Highlight with questions' : 'Highlight'}
              title={annotation.note ?? annotation.thread[0]?.text}
              style={{
                left: `${(rect.x0 / layout.width) * 100}%`,
                top: `${(rect.y0 / layout.height) * 100}%`,
                width: `${((rect.x1 - rect.x0) / layout.width) * 100}%`,
                height: `${((rect.y1 - rect.y0) / layout.height) * 100}%`,
              }}
              onClick={(event) => onPickAnnotation(annotation, { x: event.clientX, y: event.clientY })}
            />
          )),
        )}
      {near &&
        termMarks.map((mark, i) => (
          <button
            key={`term-${i}`}
            type="button"
            className="mark mark-term"
            aria-label={`Meaning of ${mark.term.term}`}
            style={place(mark.box) || undefined}
            onClick={(event) => onInfo({ term: mark.term }, { x: event.clientX, y: event.clientY })}
          />
        ))}
      {near &&
        citations.map((mark, i) => (
          <button
            key={`cite-${i}`}
            type="button"
            className="mark mark-cite"
            aria-label="Cited paper"
            style={place(mark.box) || undefined}
            onClick={(event) => onInfo({ refs: mark.refs }, { x: event.clientX, y: event.clientY })}
          />
        ))}
      {near &&
        layout &&
        regions.map((region, i) => (
          <BlockOverlay
            key={`${resetKey}-${region.id ?? i}`}
            region={region}
            pageWidth={layout.width}
            pageHeight={layout.height}
            summariseByDefault={summarise}
            sourceRects={sourceRects[i] ?? []}
            facets={facets}
            terms={terms}
            onTerm={(term, anchor) => onInfo({ term }, anchor)}
            onEdit={(bullets, caveat) => onEditRegion(region, bullets, caveat)}
            asking={region === askingRegion}
          />
        ))}
      {onPickArea && layout && (
        <div
          className="area-picker"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            setDrag({ from: toPage(event), to: toPage(event) })
          }}
          onPointerMove={(event) => drag && setDrag({ ...drag, to: toPage(event) })}
          onPointerUp={(event) => {
            setDrag(null)
            if (dragBox && dragBox.x1 - dragBox.x0 > 12 && dragBox.y1 - dragBox.y0 > 8) onPickArea(dragBox, { x: event.clientX, y: event.clientY })
          }}
          onPointerCancel={() => setDrag(null)}
        >
          {dragBox && <div className="area-drag" style={place(dragBox) || undefined} />}
        </div>
      )}
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
