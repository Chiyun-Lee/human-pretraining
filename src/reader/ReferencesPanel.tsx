import { useState } from 'react'
import { type Reference, referenceLine } from '../library/bibliography'
import { addPaperFromLink } from '../library/papers'

type AddState = 'adding' | 'added' | 'failed'

/** The paper's reference list, with each cited paper one click from the library. */
export function ReferencesPanel({ refs, onClose }: { refs: Reference[]; onClose: () => void }) {
  const [state, setState] = useState<Record<number, AddState>>({})

  const add = async (index: number, doi: string) => {
    setState((current) => ({ ...current, [index]: 'adding' }))
    try {
      await addPaperFromLink(doi)
      setState((current) => ({ ...current, [index]: 'added' }))
    } catch {
      setState((current) => ({ ...current, [index]: 'failed' }))
    }
  }

  return (
    <aside className="panel" aria-label="References">
      <header>
        <h2>References ({refs.length})</h2>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </header>
      <ol>
        {refs.map((ref, i) => (
          <li key={i}>
            <span>{referenceLine(ref)}</span>
            {ref.doi && (
              <span className="row">
                <a href={`https://doi.org/${ref.doi}`} target="_blank" rel="noreferrer">
                  {ref.doi}
                </a>
                {state[i] === 'added' ? (
                  <span className="muted">In your library</span>
                ) : (
                  <button type="button" className="button" disabled={state[i] === 'adding'} onClick={() => void add(i, ref.doi!)}>
                    {state[i] === 'adding' ? 'Adding…' : state[i] === 'failed' ? 'No open PDF found. Retry' : 'Add to library'}
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
    </aside>
  )
}
