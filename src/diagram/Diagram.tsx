// A branched flow diagram: rows of cells joined by arrows, top to bottom.
// A row with several cells is a set of branches: side by side on a wide
// screen, one under another (each reading left to right) on a narrow one. Used for a
// paper's slide and a codebase's overview.
import { type CSSProperties, Fragment } from 'react'

export type Tone = 'question' | 'approach' | 'test' | 'finding' | 'meaning'

export interface Step {
  text: string
  /** The reason for this step, shown as a small note under it. */
  why?: string
}

export interface Cell {
  tone: Tone
  label?: string
  text?: string
  why?: string
  /** Smaller cells inside this one, in order. */
  steps?: Step[]
}

export type Row = Cell[]

const columns = (count: number, head: boolean) => Array.from({ length: count }, (_, i) => <i key={i} className={head ? 'head' : undefined} />)

/** The lines from a row of `from` cells to a row of `to` cells. */
function Link({ from, to }: { from: number; to: number }) {
  if (from === to) return <div className="diagram-link">{columns(to, true)}</div>
  return (
    <>
      {from > 1 ? <div className="diagram-link join" style={{ '--n': from } as CSSProperties}>{columns(from, false)}</div> : <div className="diagram-link stub">{columns(1, false)}</div>}
      {to > 1 ? <div className="diagram-link fork" style={{ '--n': to } as CSSProperties}>{columns(to, true)}</div> : <div className="diagram-link stub">{columns(1, true)}</div>}
    </>
  )
}

function CellBox({ cell }: { cell: Cell }) {
  return (
    <section className={`cell tone-${cell.tone}`}>
      {cell.label && <h3>{cell.label}</h3>}
      {cell.text && <p>{cell.text}</p>}
      {cell.steps && cell.steps.length > 0 && (
        <ol className="steps">
          {cell.steps.map((step, i) => (
            <li key={i}>
              {step.text}
              {step.why && <span className="why">{step.why}</span>}
            </li>
          ))}
        </ol>
      )}
      {cell.why && <span className="why">{cell.why}</span>}
    </section>
  )
}

/** Consecutive rows with the same number of branches, drawn as one grid so it can turn on its side on a narrow screen. */
function bands(rows: Row[]): Row[][] {
  const result: Row[][] = []
  for (const row of rows) {
    const last = result.at(-1)
    if (last && row.length > 1 && last[0]!.length === row.length) last.push(row)
    else if (row.length > 0) result.push([row])
  }
  return result
}

function Band({ rows }: { rows: Row[] }) {
  const count = rows[0]!.length
  if (count === 1) return <CellBox cell={rows[0]![0]!} />
  const style = { '--n': count, '--across': rows.map(() => 'minmax(0, 1fr)').join(' 22px ') } as CSSProperties
  return (
    <div className="diagram-band" style={style}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 && columns(count, true)}
          {row.map((cell, j) => (
            <CellBox key={j} cell={cell} />
          ))}
        </Fragment>
      ))}
    </div>
  )
}

export function Diagram({ rows }: { rows: Row[] }) {
  const shown = bands(rows)
  return (
    <div className="diagram">
      {shown.map((band, i) => (
        <Fragment key={i}>
          {i > 0 && <Link from={shown[i - 1]![0]!.length} to={band[0]!.length} />}
          <Band rows={band} />
        </Fragment>
      ))}
    </div>
  )
}
