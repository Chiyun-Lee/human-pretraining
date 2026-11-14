import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { Turn } from '../annotations/annotations'

interface Props {
  /** Screen position to open at. */
  anchor: { x: number; y: number }
  quote: string
  note: string
  thread: Turn[]
  /** The highlight is an area of the page rather than text. */
  area: boolean
  /** Which field to start in. */
  focus: 'note' | 'ask'
  /** Why questions cannot be asked, if they cannot. */
  askUnavailable?: string
  asking: boolean
  askProblem?: string
  onAsk: (question: string) => void
  /** Absent while the highlight does not exist yet. */
  onDelete?: () => void
  onSave: (note: string) => void
  onClose: () => void
}

const STARTERS = ['Explain this simply', 'Why does this matter?', 'How solid is this?']
const AREA_STARTERS = ['Explain this', 'What should I notice here?', 'Walk me through it step by step']

/** A small floating panel for a highlight: questions to Claude about it, and the reader's note. */
export function NotePopover(props: Props) {
  const { anchor, quote, thread, area, focus, askUnavailable, asking, askProblem, onAsk, onDelete, onSave, onClose } = props
  const [note, setNote] = useState(props.note)
  const [question, setQuestion] = useState('')
  const threadEnd = useRef<HTMLDivElement>(null)
  const left = Math.max(8, Math.min(anchor.x - 160, window.innerWidth - 348))
  const top = Math.max(8, Math.min(anchor.y + 8, window.innerHeight - 420))

  useEffect(() => {
    // Braces matter: scrollIntoView may return a promise, which an effect must not.
    threadEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [thread.length, asking])

  const ask = (event: FormEvent) => {
    event.preventDefault()
    if (!question.trim() || asking) return
    onAsk(question.trim())
    setQuestion('')
  }

  return (
    <div className="popover" style={{ ['--x' as string]: `${left}px`, ['--y' as string]: `${top}px` }} role="dialog" aria-label="Highlight">
      <p className="popover-quote">{area ? quote : `“${quote.length > 120 ? quote.slice(0, 120) + '…' : quote}”`}</p>

      {(thread.length > 0 || asking) && (
        <div className="thread">
          {thread.map((turn, i) => (
            <p key={i} className={turn.role === 'user' ? 'turn turn-user' : 'turn'}>
              {turn.text}
            </p>
          ))}
          {asking && <p className="turn muted">Claude is reading…</p>}
          <div ref={threadEnd} />
        </div>
      )}
      {askProblem && <p className="error">{askProblem}</p>}

      {askUnavailable ? (
        <p className="muted">{askUnavailable}</p>
      ) : (
        <>
          {thread.length === 0 && !asking && (
            <div className="chips">
              {(area ? AREA_STARTERS : STARTERS).map((starter) => (
                <button key={starter} type="button" className="chip" onClick={() => onAsk(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          )}
          <form className="row" onSubmit={ask}>
            <input
              className="input"
              placeholder={thread.length > 0 ? 'Ask a follow-up' : 'Ask Claude about this'}
              aria-label="Question"
              autoFocus={focus === 'ask'}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button type="submit" className="button primary" disabled={asking || !question.trim()}>
              Ask
            </button>
          </form>
        </>
      )}

      <textarea
        className="input"
        rows={2}
        placeholder="Your own note"
        aria-label="Your note"
        autoFocus={focus === 'note'}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="row">
        <button type="button" className="button primary" onClick={() => onSave(note.trim())}>
          Save note
        </button>
        {onDelete && (
          <button type="button" className="button" onClick={onDelete}>
            Remove
          </button>
        )}
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
