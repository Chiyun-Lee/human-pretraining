import { useRef, useState } from 'react'
import type { Box } from '../pdf/figures'
import type { Facet, Region } from '../summaries/regions'
import { saveRegionText, setShowOriginal } from '../summaries/summarise'
import { splitTerms, type Term } from './marks'
import { useFitText } from './useFitText'

interface Props {
  region: Region
  pageWidth: number
  pageHeight: number
  /** The reader-wide switch: false shows every original. */
  summariseByDefault: boolean
  /** Where each bullet's source sentence lies on the page (empty if it was not found). */
  sourceRects: Box[][]
  /** Which kinds of source sentence are marked on the original text. */
  facets: Set<Facet>
  /** The paper's defined terms, underlined in the note. */
  terms: Term[]
  onTerm: (term: Term, anchor: { x: number; y: number }) => void
}

// Page units of padding so the cover fully hides the text underneath.
const PAD = 3

export function BlockOverlay({ region, pageWidth, pageHeight, summariseByDefault, sourceRects, facets, terms, onTerm }: Props) {
  // The note's own switch is remembered across devices; while the reader-wide
  // switch shows originals, a note can still be peeked at without changing that.
  const [flipped, setFlipped] = useState(region.show_original ?? false)
  const [peek, setPeek] = useState(false)
  // The bullet whose source sentence is being shown in the original, if any.
  const [traced, setTraced] = useState<number | null>(null)
  // The note's words, which the reader can rewrite.
  const [text, setText] = useState({ bullets: region.bullets, caveat: region.caveat })
  const [draft, setDraft] = useState<{ bullets: string; caveat: string } | null>(null)
  const summarised = (summariseByDefault ? !flipped : peek) && traced === null
  const toggle = () => {
    if (traced !== null) return setTraced(null)
    if (!summariseByDefault) return setPeek(!peek)
    setFlipped(!flipped)
    if (region.id) void setShowOriginal(region.id, !flipped)
  }
  const detail = region.kind === 'detail'
  const textRef = useRef<HTMLUListElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  // A figure note keeps a readable size and grows past a short caption instead of being fitted to it.
  const figure = region.kind === 'figure'
  useFitText(textRef, summarised ? text : null)
  useFitText(labelRef, summarised && detail ? text : null)
  const look = detail ? 'block block-summary block-detail' : figure ? 'block block-summary block-figure' : 'block block-summary'

  const percent = (value: number, total: number) => `${(value / total) * 100}%`

  // A short, narrow caption leaves no room for a readable note, so widen the note about its centre.
  let x0 = region.x0 - PAD
  let width = region.x1 - region.x0 + 2 * PAD
  const minWidth = 0.55 * pageWidth
  if (summarised && figure && width < minWidth) {
    x0 = Math.min(Math.max(x0 + width / 2 - minWidth / 2, 0.04 * pageWidth), 0.96 * pageWidth - minWidth)
    width = minWidth
  }
  const y0 = region.y0 - PAD
  const height = region.y1 - region.y0 + 2 * PAD

  const save = () => {
    if (!draft) return
    const bullets = draft.bullets.split('\n').map((line) => line.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean)
    if (bullets.length === 0) return
    const next = { bullets, caveat: detail ? null : draft.caveat.trim() || null }
    setText(next)
    setDraft(null)
    if (region.id) saveRegionText(region.id, next.bullets, next.caveat).catch(() => alert('That could not be saved. Check your connection.'))
  }

  // A bullet still stands for its source only while it has not been rewritten.
  const sourceOf = (i: number) => (text.bullets[i] === region.bullets[i] && (sourceRects[i]?.length ?? 0) > 0 ? sourceRects[i]! : null)

  return (
    <div
      className={summarised ? look : 'block block-original'}
      style={{
        left: percent(x0, pageWidth),
        top: percent(y0, pageHeight),
        width: percent(width, pageWidth),
        [summarised && figure ? 'minHeight' : 'height']: percent(height, pageHeight),
      }}
    >
      {/* On the original text: the sentences the note was drawn from. */}
      {!summarised &&
        region.bullets.map((_, i) => {
          const rects = sourceOf(i)
          const facet = region.sources?.[i]?.facet ?? 'other'
          if (!rects || !(traced === i || (traced === null && facets.has(facet)))) return null
          return rects.map((rect, r) => (
            <span
              key={`${i}-${r}`}
              className={`source source-${facet}${traced === i ? ' source-traced' : ''}`}
              style={{
                left: percent(rect.x0 - x0, width),
                top: percent(rect.y0 - y0, height),
                width: percent(rect.x1 - rect.x0, width),
                height: percent(rect.y1 - rect.y0, height),
              }}
            />
          ))
        })}
      {summarised && detail && (
        <span ref={labelRef} className="block-label">
          {text.bullets[0]}
        </span>
      )}
      {summarised && !detail && (
        <ul ref={figure ? undefined : textRef} className="block-text">
          {text.bullets.map((bullet, i) => (
            <li
              key={i}
              className={sourceOf(i) ? 'has-source' : undefined}
              title={sourceOf(i) ? 'Show where this comes from' : undefined}
              onClick={sourceOf(i) ? () => setTraced(i) : undefined}
            >
              {splitTerms(bullet, terms).map((part, p) =>
                typeof part === 'string' ? (
                  part
                ) : (
                  <span
                    key={p}
                    className="term"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation()
                      onTerm(part.term, { x: event.clientX, y: event.clientY })
                    }}
                  >
                    {part.text}
                  </span>
                ),
              )}
            </li>
          ))}
          {text.caveat && <li className="block-caveat">{text.caveat}</li>}
        </ul>
      )}
      {summarised && !draft && (
        <button
          type="button"
          className="block-edit"
          aria-label="Edit this note"
          title="Edit this note"
          onClick={() => setDraft({ bullets: text.bullets.join('\n'), caveat: text.caveat ?? '' })}
        >
          ✎
        </button>
      )}
      {draft && (
        <form
          className="block-editor"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <textarea
            className="input"
            rows={detail ? 2 : 5}
            aria-label={detail ? 'Label' : 'Note, one point per line'}
            placeholder="One point per line"
            autoFocus
            value={draft.bullets}
            onChange={(event) => setDraft({ ...draft, bullets: event.target.value })}
          />
          {!detail && (
            <input
              className="input"
              aria-label="Caveat"
              placeholder="Caveat (optional)"
              value={draft.caveat}
              onChange={(event) => setDraft({ ...draft, caveat: event.target.value })}
            />
          )}
          <div className="row">
            <button type="submit" className="button primary" disabled={!draft.bullets.trim()}>
              Save
            </button>
            <button type="button" className="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <button
        type="button"
        className="block-switch"
        aria-pressed={summarised}
        aria-label={summarised ? 'Show original text' : 'Show summary'}
        title={summarised ? 'Show original text' : 'Show summary'}
        onClick={toggle}
      />
    </div>
  )
}
