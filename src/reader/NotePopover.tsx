import { useState } from 'react'

interface Props {
  /** Screen position to open at. */
  anchor: { x: number; y: number }
  quote: string
  note: string
  /** Absent while the highlight does not exist yet. */
  onDelete?: () => void
  onSave: (note: string) => void
  onClose: () => void
}

/** A small floating editor for the note attached to a highlight. */
export function NotePopover({ anchor, quote, note, onDelete, onSave, onClose }: Props) {
  const [text, setText] = useState(note)
  const left = Math.max(8, Math.min(anchor.x - 140, window.innerWidth - 288))
  const top = Math.min(anchor.y + 8, window.innerHeight - 220)

  return (
    <div className="popover" style={{ left, top }} role="dialog" aria-label="Note">
      <p className="popover-quote">“{quote.length > 120 ? quote.slice(0, 120) + '…' : quote}”</p>
      <textarea
        className="input"
        rows={3}
        placeholder="Add a note"
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="row">
        <button type="button" className="button primary" onClick={() => onSave(text.trim())}>
          Save
        </button>
        {onDelete && (
          <button type="button" className="button" onClick={onDelete}>
            Remove highlight
          </button>
        )}
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
