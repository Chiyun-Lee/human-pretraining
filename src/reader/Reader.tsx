import { useEffect, useState } from 'react'
import {
  addAnnotation,
  type Annotation,
  currentSelection,
  deleteAnnotation,
  listAnnotations,
  type PageSelection,
  setAnnotationNote,
} from '../annotations/annotations'
import { openPdf, type PdfDocument } from '../pdf/pdfjs'
import { ClaudeError } from '../summaries/invoke'
import type { Region } from '../summaries/regions'
import { type Bibliography, readPaper, saveBibliography, type Slide } from '../summaries/slide'
import { fetchSummaries, resetSummaries, summarisePaper } from '../summaries/summarise'
import { NotePopover } from './NotePopover'
import { PdfPageView } from './PdfPageView'
import { ReferencesPanel } from './ReferencesPanel'
import { SlideCard } from './SlideCard'

interface Props {
  /** PDF bytes, or a URL on this site. */
  source: ArrayBuffer | string
  name: string
  /** Library paper to load and create summaries for; absent for local test files. */
  paperId?: string
  /** Whether the user has an Anthropic key stored. */
  hasKey?: boolean
  /** Sample summaries to show instead of loading any (development only). */
  demo?: { regions: Region[]; slide: Slide }
  onClose?: () => void
}

interface OpenDocument {
  doc: PdfDocument
  aspect: number
}

/** How many of the paper's pages have summaries, and anything that stopped the rest. */
interface Progress {
  done: number
  total: number
  working: boolean
  problem?: string
}

export function Reader({ source, name, paperId, hasKey, demo, onClose }: Props) {
  const [open, setOpen] = useState<OpenDocument | null>(null)
  const [failed, setFailed] = useState(false)
  const [summarise, setSummarise] = useState(true)
  const [showBlocks, setShowBlocks] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [regions, setRegions] = useState<Region[]>(demo?.regions ?? [])
  const [slide, setSlide] = useState<Slide | null>(demo?.slide ?? null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [confirmRedo, setConfirmRedo] = useState(false)
  const [bibliography, setBibliography] = useState<Bibliography | null>(null)
  const [showRefs, setShowRefs] = useState(false)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selection, setSelection] = useState<PageSelection | null>(null)
  /** The note editor: for an existing highlight, or for a selection about to become one. */
  const [editing, setEditing] = useState<
    { anchor: { x: number; y: number }; annotation: Annotation } | { anchor: { x: number; y: number }; selection: PageSelection } | null
  >(null)

  // The reader's own highlights and notes.
  useEffect(() => {
    if (!paperId) return
    let cancelled = false
    listAnnotations(paperId).then(
      (loaded) => !cancelled && setAnnotations(loaded),
      (error) => console.error(error),
    )
    return () => {
      cancelled = true
    }
  }, [paperId])

  // Offer to highlight whatever text is selected on a page.
  useEffect(() => {
    if (!paperId) return
    const update = () => setSelection(currentSelection())
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [paperId])

  const report = (error: unknown) => {
    console.error(error)
    alert('That could not be saved. Check your connection.')
  }
  const highlight = async (picked: PageSelection, note: string | null) => {
    if (!paperId) return
    try {
      const { page, rects, quote } = picked
      const saved = await addAnnotation(paperId, { page, rects, quote, note })
      setAnnotations((current) => [...current, saved])
      document.getSelection()?.removeAllRanges()
    } catch (error) {
      report(error)
    }
  }
  const saveNote = async (annotation: Annotation, note: string) => {
    try {
      await setAnnotationNote(annotation.id, note || null)
      setAnnotations((current) => current.map((a) => (a.id === annotation.id ? { ...a, note: note || null } : a)))
    } catch (error) {
      report(error)
    }
  }
  const removeAnnotation = async (annotation: Annotation) => {
    try {
      await deleteAnnotation(annotation.id)
      setAnnotations((current) => current.filter((a) => a.id !== annotation.id))
    } catch (error) {
      report(error)
    }
  }

  useEffect(() => {
    let cancelled = false
    let loaded: PdfDocument | undefined
    void (async () => {
      try {
        // PDF.js takes ownership of the buffer, so hand it a copy.
        const doc = await openPdf(typeof source === 'string' ? source : source.slice(0))
        loaded = doc
        const first = (await doc.getPage(1)).getViewport({ scale: 1 })
        if (cancelled) return
        setOpen({ doc, aspect: first.width / first.height })
      } catch (error) {
        console.error(error)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      void loaded?.loadingTask.destroy()
    }
  }, [source])

  // Load saved summaries, then have Claude write whatever is missing.
  const doc = open?.doc
  useEffect(() => {
    if (!doc || !paperId) return
    let cancelled = false
    const total = doc.numPages
    let done = 0
    const stop = (problem: string) => !cancelled && setProgress({ done, total, working: false, problem })
    const explain = (error: unknown, fallback: string) => {
      console.error(error)
      return error instanceof ClaudeError ? error.message : fallback
    }

    void (async () => {
      let saved
      try {
        saved = await fetchSummaries(paperId)
      } catch (error) {
        return stop(explain(error, 'Summaries could not be loaded. Check your connection.'))
      }
      if (cancelled) return
      setRegions(saved.regions)
      setSlide(saved.slide)
      setBibliography(saved.bibliography)
      // A paper whose DOI is known but whose references were never looked up (no Claude call needed).
      if (saved.bibliography.doi && !saved.bibliography.refs) {
        void saveBibliography(paperId, saved.bibliography.doi).then((found) => !cancelled && setBibliography(found))
      }
      done = saved.summarisedPages.length
      const complete = done >= total && saved.slide !== null
      setProgress({ done, total, working: !complete && !!hasKey })
      if (complete) return
      if (!hasKey) return stop('Add your Anthropic API key to get summaries.')

      try {
        // Claude reads the whole paper first; every page is then summarised against that one brief.
        let brief = saved.brief
        if (!brief || !saved.slide) {
          const read = await readPaper(doc, paperId, name, saved.bibliography.doi)
          brief = read.brief
          if (!cancelled) {
            setSlide(read.slide)
            setBibliography(read.bibliography)
          }
        }
        await summarisePaper(doc, paperId, brief, saved.summarisedPages, (pages, added) => {
          if (cancelled) return
          done += pages.length
          setRegions((current) => [...current, ...added])
          setProgress({ done, total, working: true })
        })
        if (!cancelled) setProgress({ done, total, working: false })
      } catch (error) {
        stop(explain(error, 'Summarising failed. Try again.'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, paperId, hasKey, name, attempt])

  const redo = async () => {
    if (!paperId) return
    setConfirmRedo(false)
    try {
      await resetSummaries(paperId)
      setRegions([])
      setSlide(null)
      setAttempt((n) => n + 1)
    } catch (error) {
      console.error(error)
      setProgress((current) => current && { ...current, working: false, problem: 'The summaries could not be reset.' })
    }
  }
  const canRedo = !!paperId && !!hasKey && !!progress && !progress.working

  return (
    <>
      <header className="toolbar">
        {onClose && (
          <button type="button" className="button" onClick={onClose}>
            ← Library
          </button>
        )}
        <span className="title">{slide?.paper_title ?? name}</span>
        {open && (
          <>
            <button
              type="button"
              className="button"
              aria-pressed={summarise}
              onClick={() => {
                setSummarise(!summarise)
                setResetKey((key) => key + 1)
              }}
            >
              {summarise ? 'Show originals' : 'Show summaries'}
            </button>
            <details className="menu" onToggle={(event) => !event.currentTarget.open && setConfirmRedo(false)}>
              <summary className="button" aria-label="More options">
                ⋯
              </summary>
              <div className="menu-items">
                <button type="button" aria-pressed={showBlocks} onClick={() => setShowBlocks(!showBlocks)}>
                  {showBlocks ? 'Hide text outlines' : 'Show text outlines'}
                </button>
                {bibliography?.refs && bibliography.refs.length > 0 && (
                  <button type="button" onClick={() => setShowRefs(true)}>
                    References ({bibliography.refs.length})
                  </button>
                )}
                {canRedo &&
                  (confirmRedo ? (
                    <button type="button" className="danger" onClick={() => void redo()}>
                      Rewrite them all (uses API credit)
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmRedo(true)}>
                      Rewrite summaries…
                    </button>
                  ))}
              </div>
            </details>
          </>
        )}
        {progress && (
          <div className="progress">
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Pages summarised"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
            >
              <div className="progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <span className="progress-label">
              {progress.problem ??
                (progress.working
                  ? slide
                    ? `Summarising: ${progress.done} of ${progress.total} pages`
                    : 'Reading the whole paper…'
                  : `${progress.done} of ${progress.total} pages summarised`)}
            </span>
            {progress.problem && hasKey && (
              <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </button>
            )}
          </div>
        )}
      </header>

      {failed && <p className="notice">That file could not be opened as a PDF.</p>}
      {!open && !failed && <p className="notice">Opening…</p>}

      {open && (
        <main className="pages">
          {slide && <SlideCard slide={slide} paperTitle={slide.paper_title || name} doc={open.doc} />}
          {Array.from({ length: open.doc.numPages }, (_, i) => (
            <PdfPageView
              key={i + 1}
              doc={open.doc}
              pageNumber={i + 1}
              defaultAspect={open.aspect}
              regions={regions.filter((region) => region.page === i + 1)}
              annotations={annotations.filter((annotation) => annotation.page === i + 1)}
              onPickAnnotation={(annotation, anchor) => setEditing({ anchor, annotation })}
              summarise={summarise}
              showBlocks={showBlocks}
              resetKey={resetKey}
            />
          ))}
        </main>
      )}

      {showRefs && bibliography?.refs && <ReferencesPanel refs={bibliography.refs} onClose={() => setShowRefs(false)} />}

      {selection && !editing && (
        <div
          className="selection-bar"
          style={{
            left: Math.max(8, Math.min(selection.anchor.x - 80, window.innerWidth - 176)),
            top: Math.min(selection.anchor.y + 8, window.innerHeight - 48),
          }}
          // Keep the text selected while a button is pressed.
          onPointerDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => void highlight(selection, null)}>
            Highlight
          </button>
          <button type="button" onClick={() => setEditing({ anchor: selection.anchor, selection })}>
            Add note
          </button>
        </div>
      )}

      {editing && 'annotation' in editing && (
        <NotePopover
          key={editing.annotation.id}
          anchor={editing.anchor}
          quote={editing.annotation.quote}
          note={editing.annotation.note ?? ''}
          onSave={(note) => {
            void saveNote(editing.annotation, note)
            setEditing(null)
          }}
          onDelete={() => {
            void removeAnnotation(editing.annotation)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {editing && 'selection' in editing && (
        <NotePopover
          anchor={editing.anchor}
          quote={editing.selection.quote}
          note=""
          onSave={(note) => {
            void highlight(editing.selection, note || null)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
