// The graphical abstract: one hand-drawn slide above the first page, laid out
// on a fixed 1600x900 canvas and scaled to the screen.
import { useEffect, useState } from 'react'
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

export function SlideCard({ slide, paperTitle }: { slide: Slide; paperTitle: string }) {
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

  const pointsY = y
  const bottom = H - PAD
  const bullets: { y: number; lines: string[] }[] = []
  let bulletY = y + 50
  for (const bullet of slide.bullets) {
    const lines = wrap(bullet, inner - 34, 27)
    if (bulletY + (lines.length - 1) * 35 > bottom) break
    bullets.push({ y: bulletY, lines })
    bulletY += lines.length * 35 + 16
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

        <Lines x={PAD} y={pointsY} lines={['KEY POINTS']} size={26} underline />
        {bullets.map((bullet, i) => (
          <g key={i}>
            <circle cx={PAD + 8} cy={bullet.y - 8} r={5} fill={INK} />
            <Lines x={PAD + 30} y={bullet.y} lines={bullet.lines} size={27} />
          </g>
        ))}
        <Lines x={PAD} y={H - 18} lines={wrap(paperTitle, inner, 14).slice(0, 1)} size={14} opacity={0.5} />
      </svg>
    </section>
  )
}
