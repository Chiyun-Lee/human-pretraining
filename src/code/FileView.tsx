import { useState } from 'react'
import type { Section } from './codebases'

interface Props {
  path: string
  code: string
  /** Null while Claude is writing them, or when there is no key. */
  sections: Section[] | null
  /** The reader-wide switch: false shows all the code. */
  summarise: boolean
  /** The section Claude is being asked about. */
  asking: number | null
}

function Lines({ lines, from }: { lines: string[]; from: number }) {
  return (
    <pre className="code-lines">
      {lines.map((line, i) => (
        <div key={i} className="code-line">
          <span className="code-number">{from + i}</span>
          <code>{line || ' '}</code>
        </div>
      ))}
    </pre>
  )
}

function SectionView({ section, index, lines, summarise, asking }: { section: Section; index: number; lines: string[]; summarise: boolean; asking: boolean }) {
  // null follows the reader-wide switch; a section can be flipped on its own.
  const [open, setOpen] = useState<boolean | null>(null)
  const showCode = open ?? !summarise
  const detail = section.kind === 'detail'
  const count = section.end - section.start + 1

  return (
    <section className={`code-section${detail ? ' code-detail' : ''}${asking ? ' asking' : ''}`} data-section={index}>
      <header>
        <button type="button" className="code-title" aria-expanded={showCode} onClick={() => setOpen(!showCode)}>
          <span className="code-caret">{showCode ? '▾' : '▸'}</span>
          {section.title}
          <span className="muted">
            {count === 1 ? `line ${section.start}` : `lines ${section.start}–${section.end}`}
          </span>
        </button>
      </header>
      {!detail && (
        <ul className="code-note">
          {section.bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      )}
      {showCode && <Lines lines={lines} from={section.start} />}
    </section>
  )
}

/** A source file as a column of notes, each folding away the code it describes. */
export function FileView({ code, sections, summarise, asking }: Props) {
  const lines = code.split('\n')
  if (!sections) return <Lines lines={lines} from={1} />

  // Sections in order, with any lines between them (blank lines, mostly) shown as they are.
  const parts: React.ReactNode[] = []
  let next = 1
  sections.forEach((section, i) => {
    const gap = lines.slice(next - 1, section.start - 1)
    if (gap.some((line) => line.trim())) parts.push(<Lines key={`gap-${i}`} lines={gap} from={next} />)
    parts.push(
      <SectionView key={i} section={section} index={i} lines={lines.slice(section.start - 1, section.end)} summarise={summarise} asking={asking === i} />,
    )
    next = section.end + 1
  })
  const tail = lines.slice(next - 1)
  if (tail.some((line) => line.trim())) parts.push(<Lines key="tail" lines={tail} from={next} />)
  return <div className="code-file">{parts}</div>
}
