import { useEffect, useState } from 'react'
import { type Reference, referenceLine } from '../library/bibliography'
import { addPaperFromLink } from '../library/papers'
import type { Term } from './marks'

export type Info = { term: Term } | { refs: Reference[] }

interface Props {
  anchor: { x: number; y: number }
  info: Info
  /** DOIs (lower case) of the papers already in the library. */
  inLibrary: Set<string>
  onAdded: (doi: string) => void
  onClose: () => void
}

interface Outline {
  summary: string | null
  citations: number | null
}

const outlines = new Map<string, Promise<Outline | null>>()

/** A one-line summary of a paper from Semantic Scholar, if it has one. */
function fetchOutline(doi: string): Promise<Outline | null> {
  let request = outlines.get(doi)
  if (!request) {
    request = fetch(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=tldr,abstract,citationCount`)
      .then(async (response) => {
        if (!response.ok) return null
        const paper = (await response.json()) as { tldr?: { text?: string } | null; abstract?: string | null; citationCount?: number }
        const abstract = paper.abstract && paper.abstract.length > 320 ? paper.abstract.slice(0, 320).trimEnd() + '…' : paper.abstract
        return { summary: paper.tldr?.text ?? abstract ?? null, citations: paper.citationCount ?? null }
      })
      .catch(() => null)
    outlines.set(doi, request)
  }
  return request
}

function CitedPaper({ reference, inLibrary, onAdded }: { reference: Reference; inLibrary: boolean; onAdded: (doi: string) => void }) {
  const [outline, setOutline] = useState<Outline | null>(null)
  const [adding, setAdding] = useState<'adding' | 'failed' | null>(null)
  const { doi } = reference

  useEffect(() => {
    if (!doi) return
    let cancelled = false
    void fetchOutline(doi).then((found) => !cancelled && setOutline(found))
    return () => {
      cancelled = true
    }
  }, [doi])

  const add = async () => {
    if (!doi) return
    setAdding('adding')
    try {
      await addPaperFromLink(doi)
      setAdding(null)
      onAdded(doi)
    } catch {
      setAdding('failed')
    }
  }

  return (
    <li>
      <strong>{referenceLine(reference)}</strong>
      {outline?.summary && <p>{outline.summary}</p>}
      {doi && (
        <span className="row">
          <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">
            Open
          </a>
          {outline?.citations != null && <span className="muted">Cited by {outline.citations.toLocaleString()}</span>}
          {inLibrary ? (
            <span className="in-library">In your library</span>
          ) : (
            <button type="button" className="button" disabled={adding === 'adding'} onClick={() => void add()}>
              {adding === 'adding' ? 'Adding…' : adding === 'failed' ? 'No open PDF found. Retry' : 'Add to library'}
            </button>
          )}
        </span>
      )}
    </li>
  )
}

/** A small card for something in the text: a term's meaning, or the papers a citation points to. */
export function InfoCard({ anchor, info, inLibrary, onAdded, onClose }: Props) {
  const left = Math.max(8, Math.min(anchor.x - 160, window.innerWidth - 348))
  const top = Math.max(8, Math.min(anchor.y + 10, window.innerHeight - 260))

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="popover info" style={{ ['--x' as string]: `${left}px`, ['--y' as string]: `${top}px` }} role="dialog" aria-label="Details">
        {'term' in info ? (
          <p>
            <strong>{info.term.term}</strong>: {info.term.meaning}
          </p>
        ) : (
          <ul>
            {info.refs.slice(0, 6).map((reference, i) => (
              <CitedPaper key={i} reference={reference} inLibrary={!!reference.doi && inLibrary.has(reference.doi.toLowerCase())} onAdded={onAdded} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
