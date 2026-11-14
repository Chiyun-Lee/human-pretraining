import { useEffect, useState } from 'react'
import {
  addAnnotation,
  type Annotation,
  currentSelection,
  deleteAnnotation,
  listAnnotations,
  type PageSelection,
  setAnnotationNote,
  setAnnotationThread,
} from '../annotations/annotations'
import { type Card, createCards, listPaperCards, saveGuess } from '../learning/cards'
import { Quiz } from '../learning/Quiz'
import { openPdf, type PdfDocument } from '../pdf/pdfjs'
import { ClaudeError, invokeClaude } from '../summaries/invoke'
import type { Region } from '../summaries/regions'
import { type Bibliography, type Brief, readPaper, saveBibliography, type Slide } from '../summaries/slide'
import { fetchSummaries, readPageBlocks, resetSummaries, summarisePaper } from '../summaries/summarise'
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

type Point = { x: number; y: number }

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
  const [brief, setBrief] = useState<Brief | null>(null)
  /** The highlight panel: for an existing highlight, or for a selection about to become one. */
  const [editing, setEditing] = useState<
    | { anchor: Point; focus: 'note' | 'ask'; id: string }
    | { anchor: Point; focus: 'note' | 'ask'; selection: PageSelection }
    | null
  >(null)
  /** The paper's questions; null until loaded. */
  const [cards, setCards] = useState<Card[] | null>(null)
  const [writingCards, setWritingCards] = useState(false)
  /** The cards being asked in the quiz panel, fixed when it opens. */
  const [quiz, setQuiz] = useState<Card[] | null>(null)
  const [asking, setAsking] = useState(false)
  const [askProblem, setAskProblem] = useState<string>()

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
  const highlight = async (picked: PageSelection, note: string | null): Promise<Annotation | null> => {
    if (!paperId) return null
    try {
      const { page, rects, quote } = picked
      const saved = await addAnnotation(paperId, { page, rects, quote, note, thread: [] })
      setAnnotations((current) => [...current, saved])
      document.getSelection()?.removeAllRanges()
      return saved
    } catch (error) {
      report(error)
      return null
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
    if (!paperId) return
    let cancelled = false
    listPaperCards(paperId).then(
      (loaded) => !cancelled && setCards(loaded),
      (error) => console.error(error),
    )
    return () => {
      cancelled = true
    }
  }, [paperId])

  /** Has Claude write this paper's questions. Returns them, or null if that failed. */
  const writeCards = async (doc: PdfDocument, from: Brief): Promise<Card[] | null> => {
    if (!paperId) return null
    setWritingCards(true)
    try {
      const written = await createCards(doc, paperId, from)
      setCards(written)
      return written
    } catch (error) {
      console.error(error)
      return null
    } finally {
      setWritingCards(false)
    }
  }
  const updateCard = (card: Card) => setCards((current) => current && current.map((c) => (c.id === card.id ? card : c)))
  const guesses = (cards ?? []).filter((card) => card.kind === 'predict' && card.last_response === null && card.reps === 0)
  const startQuiz = async () => {
    if (!open || !brief) return
    const all = cards && cards.length > 0 ? cards : await writeCards(open.doc, brief)
    if (!all) return alert('The questions could not be written. Try again.')
    const now = Date.now()
    setQuiz(all.filter((card) => new Date(card.due).getTime() <= now))
  }

  const edited = editing && 'id' in editing ? annotations.find((a) => a.id === editing.id) : undefined
  const closeEditing = () => {
    setEditing(null)
    setAskProblem(undefined)
  }

  /** Sends a question about the open highlight (creating it first if it is still just a selection). */
  const ask = async (question: string) => {
    if (!editing || !brief || !open || asking) return
    setAskProblem(undefined)
    setAsking(true)
    try {
      let target = edited
      if ('selection' in editing) {
        target = (await highlight(editing.selection, null)) ?? undefined
        if (target) setEditing({ anchor: editing.anchor, focus: 'ask', id: target.id })
      }
      if (!target) return
      const { id, page, quote, thread: history } = target
      const context = (await readPageBlocks(open.doc, page)).map((block) => block.text).join('\n\n')
      const { answer } = await invokeClaude<{ answer: string }>('ask', { brief, context, quote, history, question })
      const thread = [...history, { role: 'user' as const, text: question }, { role: 'claude' as const, text: answer }]
      setAnnotations((current) => current.map((a) => (a.id === id ? { ...a, thread } : a)))
      await setAnnotationThread(id, thread)
    } catch (error) {
      console.error(error)
      setAskProblem(error instanceof ClaudeError ? error.message : 'The answer could not be saved. Check your connection.')
    } finally {
      setAsking(false)
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
      setBrief(saved.brief)
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
          // The questions are written alongside the page summaries; the first few are asked before reading.
          if (!cancelled) void writeCards(doc, read.brief)
          if (!cancelled) {
            setBrief(read.brief)
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
            {paperId && brief && (
              <button type="button" className="button" disabled={writingCards} onClick={() => void startQuiz()}>
                {writingCards ? 'Writing questions…' : 'Quiz'}
              </button>
            )}
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
          {writingCards && cards?.length === 0 && <p className="notice">Writing a few questions for you to guess at first…</p>}
          {guesses.length > 0 && (
            <Quiz
              title="Before you read"
              cards={guesses}
              predict
              inline
              onChanged={updateCard}
              onClose={() => {
                for (const card of guesses) void saveGuess(card, '')
                setCards((current) => current && current.map((c) => (guesses.includes(c) ? { ...c, last_response: '' } : c)))
              }}
            />
          )}
          {slide && guesses.length === 0 && !(writingCards && cards?.length === 0) && (
            <SlideCard slide={slide} paperTitle={slide.paper_title || name} doc={open.doc} />
          )}
          {Array.from({ length: open.doc.numPages }, (_, i) => (
            <PdfPageView
              key={i + 1}
              doc={open.doc}
              pageNumber={i + 1}
              defaultAspect={open.aspect}
              regions={regions.filter((region) => region.page === i + 1)}
              annotations={annotations.filter((annotation) => annotation.page === i + 1)}
              onPickAnnotation={(annotation, anchor) => setEditing({ anchor, focus: 'note', id: annotation.id })}
              summarise={summarise}
              showBlocks={showBlocks}
              resetKey={resetKey}
            />
          ))}
        </main>
      )}

      {showRefs && bibliography?.refs && <ReferencesPanel refs={bibliography.refs} onClose={() => setShowRefs(false)} />}

      {quiz && (
        <Quiz
          title="Quiz"
          cards={quiz}
          onChanged={updateCard}
          onRemoved={(id) => setCards((current) => current && current.filter((c) => c.id !== id))}
          onClose={() => setQuiz(null)}
        />
      )}

      {selection && !editing && (
        <div
          className="selection-bar"
          style={{
            left: Math.max(8, Math.min(selection.anchor.x - 100, window.innerWidth - 216)),
            top: Math.min(selection.anchor.y + 8, window.innerHeight - 48),
          }}
          // Keep the text selected while a button is pressed.
          onPointerDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => void highlight(selection, null)}>
            Highlight
          </button>
          <button type="button" onClick={() => setEditing({ anchor: selection.anchor, focus: 'ask', selection })}>
            Ask
          </button>
          <button type="button" onClick={() => setEditing({ anchor: selection.anchor, focus: 'note', selection })}>
            Note
          </button>
        </div>
      )}

      {editing && ('selection' in editing || edited) && (
        <NotePopover
          key={'id' in editing ? editing.id : 'new'}
          anchor={editing.anchor}
          focus={editing.focus}
          quote={edited?.quote ?? ('selection' in editing ? editing.selection.quote : '')}
          note={edited?.note ?? ''}
          thread={edited?.thread ?? []}
          askUnavailable={brief ? undefined : hasKey ? 'Questions open once Claude has read the paper.' : 'Add your Anthropic API key to ask questions.'}
          asking={asking}
          askProblem={askProblem}
          onAsk={(question) => void ask(question)}
          onSave={(note) => {
            if (edited) void saveNote(edited, note)
            else if ('selection' in editing) void highlight(editing.selection, note || null)
            closeEditing()
          }}
          onDelete={edited && (() => {
            void removeAnnotation(edited)
            closeEditing()
          })}
          onClose={closeEditing}
        />
      )}
    </>
  )
}
