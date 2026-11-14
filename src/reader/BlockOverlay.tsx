import { useRef, useState } from 'react'
import type { Region } from '../summaries/regions'
import { setShowOriginal } from '../summaries/summarise'
import { useFitText } from './useFitText'

interface Props {
  region: Region
  pageWidth: number
  pageHeight: number
  /** The reader-wide switch: false shows every original. */
  summariseByDefault: boolean
}

// Page units of padding so the cover fully hides the text underneath.
const PAD = 3

export function BlockOverlay({ region, pageWidth, pageHeight, summariseByDefault }: Props) {
  // The note's own switch is remembered across devices; while the reader-wide
  // switch shows originals, a note can still be peeked at without changing that.
  const [flipped, setFlipped] = useState(region.show_original ?? false)
  const [peek, setPeek] = useState(false)
  const summarised = summariseByDefault ? !flipped : peek
  const toggle = () => {
    if (!summariseByDefault) return setPeek(!peek)
    setFlipped(!flipped)
    if (region.id) void setShowOriginal(region.id, !flipped)
  }
  const detail = region.kind === 'detail'
  const textRef = useRef<HTMLUListElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  // A figure note keeps a readable size and grows past a short caption instead of being fitted to it.
  const figure = region.kind === 'figure'
  useFitText(textRef, summarised ? region : null)
  useFitText(labelRef, summarised && detail ? region : null)
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

  return (
    <div
      className={summarised ? look : 'block block-original'}
      style={{
        left: percent(x0, pageWidth),
        top: percent(region.y0 - PAD, pageHeight),
        width: percent(width, pageWidth),
        [summarised && figure ? 'minHeight' : 'height']: percent(region.y1 - region.y0 + 2 * PAD, pageHeight),
      }}
    >
      {summarised && detail && (
        <span ref={labelRef} className="block-label">
          {region.bullets[0]}
        </span>
      )}
      {summarised && !detail && (
        <ul ref={figure ? undefined : textRef} className="block-text">
          {region.bullets.map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
          {region.caveat && <li className="block-caveat">{region.caveat}</li>}
        </ul>
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
