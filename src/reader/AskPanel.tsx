import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { Turn } from '../annotations/annotations'

/** A line in the conversation: something said, or a change Claude made to the note. */
export type ChatLine = Turn | { role: 'edit'; undone: boolean }

interface Props {
  /** What is being asked about; null for the paper (or project) as a whole. */
  subject: { quote: string; area: boolean; page: number } | null
  /** What the whole thing is called in the heading. */
  whole?: 'paper' | 'project'
  /** Whether there is a summary note over the selection, which Claude can rewrite. */
  hasNote: boolean
  lines: ChatLine[]
  asking: boolean
  problem?: string
  /** Why questions cannot be asked, if they cannot. */
  unavailable?: string
  onAsk: (question: string) => void
  onUndo: (line: number) => void
  /** Present for a whole-paper conversation: switch to marking out a figure or equation instead. */
  onPickArea?: () => void
  /** Present when the conversation belongs to a saved highlight. */
  onRemove?: () => void
  onClose: () => void
}

const STARTERS = {
  paper: ['What is the one thing to take away?', 'What is the weakest part of the argument?', 'What would I need to know first?'],
  project: ['Where should I start reading?', 'How does a request flow through this?', 'What is the riskiest part of this code?'],
  code: ['Explain this simply', 'Why is it written this way?', 'What calls this?'],
  text: ['Explain this simply', 'Why does this matter?', 'How solid is this?'],
  area: ['Explain this', 'What should I notice here?', 'Walk me through it step by step'],
}

/** The conversation with Claude: about a selection, an area of a page, or the whole paper. */
export function AskPanel({ subject, whole = 'paper', hasNote, lines, asking, problem, unavailable, onAsk, onUndo, onPickArea, onRemove, onClose }: Props) {
  const [question, setQuestion] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Braces matter: scrollIntoView may return a promise, which an effect must not.
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [lines.length, asking])

  const send = (event: FormEvent) => {
    event.preventDefault()
    if (!question.trim() || asking) return
    onAsk(question.trim())
    setQuestion('')
  }
  const starters = STARTERS[subject ? (subject.area ? 'area' : whole === 'project' ? 'code' : 'text') : whole]

  return (
    <aside className="ask" aria-label="Ask Claude">
      <header>
        <h2>{subject ? 'Ask about this' : `Ask about the ${whole}`}</h2>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </header>
      {subject && (
        <blockquote>{subject.area ? `Area on page ${subject.page}` : subject.quote.length > 220 ? subject.quote.slice(0, 220) + '…' : subject.quote}</blockquote>
      )}

      <div className="thread">
        {lines.map((line, i) =>
          line.role === 'edit' ? (
            <p key={i} className="turn turn-edit">
              {line.undone ? 'Note change undone.' : '✎ Note updated.'}
              {!line.undone && (
                <button type="button" onClick={() => onUndo(i)}>
                  Undo
                </button>
              )}
            </p>
          ) : (
            <p key={i} className={line.role === 'user' ? 'turn turn-user' : 'turn'}>
              {line.text}
            </p>
          ),
        )}
        {asking && <p className="turn muted">Claude is reading…</p>}
        {problem && <p className="error">{problem}</p>}
        <div ref={end} />
      </div>

      {unavailable ? (
        <p className="muted">{unavailable}</p>
      ) : (
        <>
          {lines.length === 0 && !asking && (
            <div className="chips">
              {starters.map((starter) => (
                <button key={starter} type="button" className="chip" onClick={() => onAsk(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={send}>
            <textarea
              className="input"
              rows={2}
              placeholder={hasNote ? 'Ask, or say “add that to the note”' : 'Ask a question'}
              aria-label="Question"
              autoFocus
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) send(event)
              }}
            />
            <button type="submit" className="button primary" disabled={asking || !question.trim()}>
              Send
            </button>
          </form>
        </>
      )}
      {onPickArea && (
        <button type="button" className="quiz-remove" onClick={onPickArea}>
          Ask about a figure, table or equation instead
        </button>
      )}
      {onRemove && (
        <button type="button" className="quiz-remove" onClick={onRemove}>
          Remove this highlight
        </button>
      )}
    </aside>
  )
}
