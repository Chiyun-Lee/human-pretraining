// The graphical abstract: one hand-drawn slide above the first page, laid out
// on a fixed 1600x900 canvas and scaled to the screen.
import { useEffect, useState } from 'react'
import { cropFigure } from '../pdf/figureScan'
import type { PdfDocument } from '../pdf/pdfjs'
import type { FlowKind, Slide } from '../summaries/slide'
import { HAND_FONT, handFontReady } from './handFont'

const W = 1600
const H = 900
const PAD = 60
const INK = '#1f2f7a'

const FLOW: Record<FlowKind, { label: string; fill: string }> = {
  question: { label: 'THE QUESTION', fill: '#fdeccd' },
  approach: { label: 'WHAT THEY DID', fill: '#dfe8fb' },
  finding: { label: 'WHAT THEY FOUND', fill: '#dcf2e4' },
  meaning: { label: 'SO WHAT?', fill: '#f1e1f8' },
}

const measure = document.createElement('canvas').getContext('2d')!

/** Greedy word wrap, measured in the handwriting font. */
function wrap(text: string, width: number, size: number): string[] {
  measure.font = `${size}px ${HAND_FONT}`
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (line && measure.measureText(next).width > width) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  return line ? [...lines, line] : lines
}

function Lines({ x, y, lines, size, opacity, underline }: { x: number; y: number; lines: string[]; size: number; opacity?: number; underline?: boolean }) {
  return (
    <text x={x} y={y} fontSize={size} opacity={opacity} textDecoration={underline ? 'underline' : undefined}>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i ? size * 1.3 : 0}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

interface Props {
  slide: Slide
  paperTitle: string
  /** The open paper, from which the slide's figures are cut. */
  doc: PdfDocument
}

interface Picture {
  url: string
  width: number
  height: number
  label: string
}

const FIGURES_WIDTH = 840

export function SlideCard({ slide, paperTitle, doc }: Props) {
  const [pictures, setPictures] = useState<Picture[]>([])
  useEffect(() => {
    let current = true
    void (async () => {
      const made: Picture[] = []
      for (const figure of slide.figures ?? []) {
        try {
          const url = await cropFigure(doc, figure.page, figure)
          made.push({ url, width: figure.x1 - figure.x0, height: figure.y1 - figure.y0, label: figure.label })
        } catch (error) {
          console.error(error) // the slide is still useful without this figure
        }
      }
      if (current) setPictures(made)
    })()
    return () => {
      current = false
    }
  }, [doc, slide.figures])

  // Text is wrapped by measuring it, so wait for the font.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let current = true
    void handFontReady.then(() => current && setReady(true))
    return () => {
      current = false
    }
  }, [])
  if (!ready) return null

  const inner = W - 2 * PAD
  let y = PAD + 20
  const titleY = y
  y += 52
  const takeaway = wrap(slide.takeaway, inner, 26)
  const takeawayY = y
  y += takeaway.length * 32 + 20

  const gap = 46
  const steps = slide.flow
  const boxW = (inner - gap * (steps.length - 1)) / Math.max(steps.length, 1)
  const boxH = 168
  const flowY = y
  y += boxH + 44

  // Figures on the left, key points on the right (full width when there are no figures).
  const top = y
  const bottom = H - PAD
  const areaH = bottom - top
  const figuresW = pictures.length ? FIGURES_WIDTH : 0
  // Two figures go side by side or stacked, whichever shows them bigger.
  const shown = (slotW: number, slotH: number) =>
    pictures.reduce((sum, p) => sum + Math.min(slotW / p.width, (slotH - 70) / p.height) ** 2 * p.width * p.height, 0)
  const sideBySide = pictures.length === 2 && shown((figuresW - 20) / 2, areaH) > shown(figuresW, (areaH - 20) / 2)
  const slots = pictures.map((picture, i) => {
    const slotW = sideBySide ? (figuresW - 20) / 2 : figuresW
    const slotH = sideBySide ? areaH : (areaH - 20 * (pictures.length - 1)) / pictures.length
    const label = wrap(picture.label, slotW - 24, 20).slice(0, 3)
    return {
      picture,
      label,
      x: sideBySide ? PAD + i * (slotW + 20) : PAD,
      y: sideBySide ? top : top + i * (slotH + 20),
      w: slotW,
      h: slotH,
      imageH: slotH - 14 - label.length * 26,
    }
  })

  const pointsX = pictures.length ? PAD + figuresW + 50 : PAD
  const pointsW = W - PAD - pointsX
  const pointSize = pictures.length ? 22 : 27
  const pointsY = top + (pictures.length ? 24 : 0)
  const bullets: { y: number; lines: string[] }[] = []
  let bulletY = pointsY + 50
  for (const bullet of slide.bullets) {
    const lines = wrap(bullet, pointsW - 34, pointSize)
    if (bulletY + (lines.length - 1) * pointSize * 1.3 > bottom) break
    bullets.push({ y: bulletY, lines })
    bulletY += lines.length * pointSize * 1.3 + 16
  }

  return (
    <section className="slide" aria-label="Graphical abstract">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${slide.title}. ${slide.takeaway}`}>
        <defs>
          <marker id="slide-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill={INK} />
          </marker>
        </defs>
        <Lines x={PAD} y={titleY} lines={wrap(slide.title.toUpperCase(), inner, 46).slice(0, 1)} size={46} underline />
        <Lines x={PAD} y={takeawayY} lines={takeaway} size={26} opacity={0.85} />

        {steps.map((step, i) => {
          const x = PAD + i * (boxW + gap)
          const kind = FLOW[step.kind] ?? FLOW.approach
          return (
            <g key={i}>
              <rect x={x} y={flowY} width={boxW} height={boxH} rx={16} fill={kind.fill} stroke={INK} strokeWidth={2} />
              <Lines x={x + 16} y={flowY + 30} lines={[kind.label]} size={15} opacity={0.7} />
              <Lines x={x + 16} y={flowY + 62} lines={wrap(step.text, boxW - 32, 21).slice(0, 4)} size={21} />
              {i < steps.length - 1 && (
                <path
                  d={`M${x + boxW + 6} ${flowY + boxH / 2} h${gap - 14}`}
                  stroke={INK}
                  strokeWidth={3}
                  fill="none"
                  markerEnd="url(#slide-arrow)"
                />
              )}
            </g>
          )
        })}

        {slots.map((slot, i) => (
          <g key={i}>
            <rect x={slot.x} y={slot.y} width={slot.w} height={slot.h} rx={12} fill="#fff" stroke={INK} strokeWidth={1.5} strokeDasharray="6 5" />
            <image
              href={slot.picture.url}
              x={slot.x + 8}
              y={slot.y + 8}
              width={slot.w - 16}
              height={slot.imageH - 8}
              preserveAspectRatio="xMidYMid meet"
            />
            <Lines x={slot.x + 12} y={slot.y + slot.imageH + 22} lines={slot.label} size={20} />
          </g>
        ))}

        <Lines x={pointsX} y={pointsY} lines={['KEY POINTS']} size={26} underline />
        {bullets.map((bullet, i) => (
          <g key={i}>
            <circle cx={pointsX + 8} cy={bullet.y - pointSize * 0.3} r={pictures.length ? 4 : 5} fill={INK} />
            <Lines x={pointsX + 30} y={bullet.y} lines={bullet.lines} size={pointSize} />
          </g>
        ))}
        <Lines x={PAD} y={H - 18} lines={wrap(paperTitle, inner, 14).slice(0, 1)} size={14} opacity={0.5} />
      </svg>
    </section>
  )
}
