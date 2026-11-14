import { useEffect, useMemo, useState } from 'react'
import {
  addAnnotation,
  type Turn,
  type Annotation,
  currentSelection,
  deleteAnnotation,
  listAnnotations,
  type PageSelection,
  setAnnotationThread,
} from '../annotations/annotations'
import { type Card, createCards, listPaperCards, saveGuess } from '../learning/cards'
import { Quiz } from '../learning/Quiz'
import type { Reference } from '../library/bibliography'
import type { Box } from '../pdf/figures'
import { supabase } from '../lib/supabase'
import { cropFigure } from '../pdf/figureScan'
import { openPdf, type PdfDocument } from '../pdf/pdfjs'
import { ClaudeError, invokeClaude } from '../summaries/invoke'
import type { Facet, Region } from '../summaries/regions'
import { type Bibliography, type Brief, readPaper, saveBibliography, type Slide } from '../summaries/slide'
import { fetchSummaries, paperText, readPageBlocks, resetSummaries, saveRegionText, summarisePaper } from '../summaries/summarise'
import { AskPanel } from './AskPanel'
import { type Info, InfoCard } from './InfoCard'
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
  demo?: { regions: Region[]; slide: Slide; brief: Brief; refs: Reference[] }
  onClose?: () => void
}

type Point = { x: number; y: number }

const NONE: Region[] = []

/** A line of the conversation: something said, or a change Claude made to the note (with the note as it was). */
type Line = Turn | { role: 'edit'; undone: boolean; before: Region }

/** The open conversation with Claude. */
interface Chat {
  /** What it is about; null for the paper as a whole. */
  subject: { page: number; quote: string; area: boolean; rects: Box[] } | null
  /** The saved highlight (or whole-paper thread) the conversation is kept on, once there is one. */
  annotationId: string | null
  /** Whether to keep it: a selection inside a note leaves no mark on the page to come back to. */
  keep: boolean
  /** The summary note over the selection, which Claude may rewrite. */
  regionKey: string | null
  lines: Line[]
}

const keyOf = (region: Region) => region.id ?? `${region.page}/${region.x0}/${region.y0}`
const isTurn = (line: Line): line is Turn => line.role !== 'edit'

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
  const [bibliography, setBibliography] = useState<Bibliography | null>(demo ? { doi: null, meta: null, refs: demo.refs } : null)
  const [showRefs, setShowRefs] = useState(false)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selection, setSelection] = useState<PageSelection | null>(null)
  const [brief, setBrief] = useState<Brief | null>(demo?.brief ?? null)
  const [chat, setChat] = useState<Chat | null>(null)
  /** Kinds of source sentence marked on original text. */
  const [facets, setFacets] = useState<Set<Facet>>(new Set(['goal', 'method', 'result']))
  const [info, setInfo] = useState<{ info: Info; anchor: Point } | null>(null)
  const [inLibrary, setInLibrary] = useState<Set<string>>(new Set())
  /** Whether dragging on a page marks out an area to ask about. */
  const [picking, setPicking] = useState(false)
  const regionsByPage = useMemo(() => {
    const pages = new Map<number, Region[]>()
    for (const region of regions) pages.set(region.page, [...(pages.get(region.page) ?? []), region])
    return pages
  }, [regions])
  const terms = useMemo(() => brief?.terms ?? [], [brief])
  const refs = useMemo(() => bibliography?.refs ?? [], [bibliography])

  // Which cited papers the reader already has.
  useEffect(() => {
    if (!paperId) return
    let cancelled = false
    void supabase
      .from('papers')
      .select('doi')
      .not('doi', 'is', null)
      .then(({ data }) => !cancelled && data && setInLibrary(new Set(data.map((row) => (row.doi as string).toLowerCase()))))
    return () => {
      cancelled = true
    }
  }, [paperId])

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

  // Offer to ask about, or highlight, whatever text is selected on a page or in a note.
  const canSelect = !!paperId || !!demo
  useEffect(() => {
    if (!canSelect) return
    const update = () => setSelection(currentSelection())
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [canSelect])

  const report = (error: unknown) => {
    console.error(error)
    alert('That could not be saved. Check your connection.')
  }
  const highlight = async (picked: PageSelection) => {
    if (!paperId) return
    try {
      const { page, rects, quote } = picked
      const saved = await addAnnotation(paperId, { page, rects, quote, note: null, thread: [], area: false })
      setAnnotations((current) => [...current, saved])
      document.getSelection()?.removeAllRanges()
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

  /** Rewrites a note, keeping the source sentence of every bullet that is unchanged. */
  const rewrite = (key: string, bullets: string[], caveat: string | null) => {
    const region = regions.find((r) => keyOf(r) === key)
    if (!region) return
    const blank = { quote: '', facet: 'other' as const }
    const sources = region.sources ? bullets.map((bullet) => region.sources![region.bullets.indexOf(bullet)] ?? blank) : null
    replaceRegion({ ...region, bullets, caveat, sources })
  }
  const replaceRegion = (next: Region) => {
    setRegions((current) => current.map((r) => (keyOf(r) === keyOf(next) ? next : r)))
    if (next.id) saveRegionText(next.id, next.bullets, next.caveat, next.sources ?? null).catch(report)
  }

  const regionAt = (page: number, at: Point) =>
    regions.find((r) => r.page === page && at.x >= r.x0 - 3 && at.x <= r.x1 + 3 && at.y >= r.y0 - 3 && at.y <= r.y1 + 3)
  const askAbout = (picked: PageSelection) => {
    const region = regionAt(picked.page, picked.at)
    setAskProblem(undefined)
    setChat({
      subject: { page: picked.page, quote: picked.quote, area: !!picked.area, rects: picked.rects },
      annotationId: null,
      keep: picked.rects.length > 0,
      regionKey: region && region.kind !== 'detail' ? keyOf(region) : null,
      lines: [],
    })
  }
  const askAboutPaper = () => {
    const saved = annotations.find((a) => a.page === 0)
    setAskProblem(undefined)
    setChat({ subject: null, annotationId: saved?.id ?? null, keep: true, regionKey: null, lines: saved?.thread ?? [] })
  }
  const reopen = (annotation: Annotation) => {
    const first = annotation.rects[0]
    const region = first && regionAt(annotation.page, { x: (first.x0 + first.x1) / 2, y: (first.y0 + first.y1) / 2 })
    setAskProblem(undefined)
    setChat({
      subject: { page: annotation.page, quote: annotation.quote, area: annotation.area, rects: annotation.rects },
      annotationId: annotation.id,
      keep: true,
      regionKey: region && region.kind !== 'detail' ? keyOf(region) : null,
      lines: annotation.thread,
    })
  }
  const chatRegion = chat?.regionKey ? (regions.find((r) => keyOf(r) === chat.regionKey) ?? null) : null

  /** Sends a question in the open conversation. */
  const ask = async (question: string) => {
    if (!chat || !brief || !open || asking) return
    const { subject } = chat
    const history = chat.lines.filter(isTurn)
    const asked: Turn = { role: 'user', text: question }
    setAskProblem(undefined)
    setAsking(true)
    setChat({ ...chat, lines: [...chat.lines, asked] })
    try {
      // A selection is answered from its page; a general question from the whole paper.
      const context = subject
        ? (await readPageBlocks(open.doc, subject.page)).map((block) => block.text).join('\n\n')
        : await paperText(open.doc)
      // For an area, Claude is shown the picture of it.
      const image = subject?.area && subject.rects[0] ? (await cropFigure(open.doc, subject.page, subject.rects[0], 900)).split(',')[1] : undefined
      const note = chatRegion ? { bullets: chatRegion.bullets, caveat: chatRegion.caveat } : undefined
      const reply = await invokeClaude<{ answer: string; note: { bullets: string[]; caveat: string | null } | null }>('ask', {
        brief,
        context,
        quote: subject?.quote ?? '',
        history,
        question,
        image,
        note,
      })
      const answered: Turn = { role: 'claude', text: reply.answer }
      const added: Line[] = [answered]
      if (reply.note && chatRegion) {
        added.push({ role: 'edit', undone: false, before: chatRegion })
        rewrite(keyOf(chatRegion), reply.note.bullets, reply.note.caveat)
      }
      setChat((current) => current && { ...current, lines: [...current.lines, ...added] })

      if (chat.keep && paperId) {
        const thread = [...history, asked, answered]
        if (chat.annotationId) {
          const id = chat.annotationId
          setAnnotations((current) => current.map((a) => (a.id === id ? { ...a, thread } : a)))
          await setAnnotationThread(id, thread)
        } else {
          const saved = await addAnnotation(paperId, {
            page: subject?.page ?? 0,
            rects: subject?.rects ?? [],
            quote: subject?.quote ?? '',
            note: null,
            thread,
            area: subject?.area ?? false,
          })
          setAnnotations((current) => [...current, saved])
          setChat((current) => current && { ...current, annotationId: saved.id })
          document.getSelection()?.removeAllRanges()
        }
      }
    } catch (error) {
      console.error(error)
      // Take the unanswered question back out, so the conversation still alternates.
      setChat((current) => current && { ...current, lines: current.lines.filter((line) => line !== asked) })
      setAskProblem(error instanceof ClaudeError ? error.message : 'Something went wrong. Check your connection and ask again.')
    } finally {
      setAsking(false)
    }
  }
  const undoEdit = (index: number) => {
    const line = chat?.lines[index]
    if (!chat || !line || line.role !== 'edit') return
    replaceRegion(line.before)
    setChat({ ...chat, lines: chat.lines.map((l, i) => (i === index ? { ...line, undone: true } : l)) })
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
            {picking ? (
              <button type="button" className="button" aria-pressed onClick={() => setPicking(false)}>
                Cancel
              </button>
            ) : (
              (paperId || demo) && (
                <button type="button" className="button" aria-pressed={chat?.subject === null} onClick={askAboutPaper}>
                  Ask ✦
                </button>
              )
            )}
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
        {open && regions.some((region) => region.sources) && (
          <div className="facets" role="group" aria-label="Mark on the original text">
            <span className="muted">On the original text, mark</span>
            {(['goal', 'method', 'result'] as const).map((facet) => (
              <button
                key={facet}
                type="button"
                className={`chip facet-${facet}`}
                aria-pressed={facets.has(facet)}
                onClick={() => {
                  const next = new Set(facets)
                  if (!next.delete(facet)) next.add(facet)
                  setFacets(next)
                }}
              >
                {facet}
              </button>
            ))}
          </div>
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
        <main className={chat ? 'pages beside-chat' : 'pages'}>
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
              regions={regionsByPage.get(i + 1) ?? NONE}
              annotations={annotations.filter((annotation) => annotation.page === i + 1)}
              onPickAnnotation={reopen}
              summarise={summarise}
              showBlocks={showBlocks}
              resetKey={resetKey}
              facets={facets}
              terms={terms}
              refs={refs}
              onInfo={(shown, anchor) => setInfo({ info: shown, anchor })}
              onEditRegion={(region, bullets, caveat) => rewrite(keyOf(region), bullets, caveat)}
              askingRegion={chatRegion}
              onPickArea={
                picking
                  ? (box, anchor) => {
                      setPicking(false)
                      askAbout({ page: i + 1, rects: [box], quote: `Area on page ${i + 1}`, anchor, at: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, area: true })
                    }
                  : undefined
              }
            />
          ))}
        </main>
      )}

      {showRefs && bibliography?.refs && <ReferencesPanel refs={bibliography.refs} onClose={() => setShowRefs(false)} />}

      {picking && <p className="hint">Drag over a figure, table or equation</p>}
      {info && (
        <InfoCard
          anchor={info.anchor}
          info={info.info}
          inLibrary={inLibrary}
          onAdded={(doi) => setInLibrary(new Set(inLibrary).add(doi.toLowerCase()))}
          onClose={() => setInfo(null)}
        />
      )}

      {quiz && (
        <Quiz
          title="Quiz"
          cards={quiz}
          onChanged={updateCard}
          onRemoved={(id) => setCards((current) => current && current.filter((c) => c.id !== id))}
          onClose={() => setQuiz(null)}
        />
      )}

      {selection && !picking && !(chat && selection.quote === chat.subject?.quote) && (
        <div
          className="selection-bar"
          style={{
            left: Math.max(8, Math.min(selection.anchor.x - 80, window.innerWidth - 176)),
            top: Math.min(selection.anchor.y + 8, window.innerHeight - 48),
          }}
          // Keep the text selected while a button is pressed.
          onPointerDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => askAbout(selection)}>
            Ask ✦
          </button>
          {paperId && selection.rects.length > 0 && (
            <button type="button" onClick={() => void highlight(selection)}>
              Highlight
            </button>
          )}
        </div>
      )}

      {chat && (
        <AskPanel
          subject={chat.subject}
          hasNote={chatRegion !== null}
          lines={chat.lines}
          asking={asking}
          problem={askProblem}
          unavailable={brief ? undefined : hasKey ? 'Questions open once Claude has read the paper.' : 'Add your Anthropic API key to ask questions.'}
          onAsk={(question) => void ask(question)}
          onUndo={undoEdit}
          onPickArea={
            chat.subject === null
              ? () => {
                  setChat(null)
                  setPicking(true)
                }
              : undefined
          }
          onRemove={
            chat.subject && chat.annotationId
              ? () => {
                  const saved = annotations.find((a) => a.id === chat.annotationId)
                  if (saved) void removeAnnotation(saved)
                  setChat(null)
                }
              : undefined
          }
          onClose={() => setChat(null)}
        />
      )}
    </>
  )
}
