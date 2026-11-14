import { useEffect, useMemo, useState } from 'react'
import type { Turn } from '../annotations/annotations'
import { AskPanel } from '../reader/AskPanel'
import { ClaudeError, invokeClaude } from '../summaries/invoke'
import { type Codebase, type CodeMap, fileSections, fileText, mapAsText, mapCodebase, placeholder, saveSections, type Section } from './codebases'
import { FileView } from './FileView'
import { buildTree, type TreeNode } from './github'

interface Props {
  codebase: Codebase
  /** Whether the user has an Anthropic key stored. */
  hasKey: boolean
  /** Sample notes to show instead of asking Claude (development only). */
  demo?: Record<string, Section[]>
  onClose?: () => void
}

type OpenFile = { path: string; code: string | null; sections: Section[] | null; working: boolean; problem?: string }
type Line = Turn | { role: 'edit'; undone: boolean; before: Section }
interface Chat {
  /** The selected text and the section it is in; null for the project as a whole. */
  subject: { quote: string; section: number | null } | null
  lines: Line[]
}

const isTurn = (line: Line): line is Turn => line.role !== 'edit'
const explain = (error: unknown, fallback: string) => (error instanceof ClaudeError || (error instanceof Error && !(error instanceof TypeError)) ? error.message : fallback)

/** A codebase as a file tree with a line on each folder and file, and each file as notes over its code. */
export function CodeViewer({ codebase, hasKey, demo, onClose }: Props) {
  const [map, setMap] = useState<CodeMap | null>(codebase.map)
  const [problem, setProblem] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [file, setFile] = useState<OpenFile | null>(null)
  const [summarise, setSummarise] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showTree, setShowTree] = useState(false)
  const [chat, setChat] = useState<Chat | null>(null)
  const [asking, setAsking] = useState(false)
  const [askProblem, setAskProblem] = useState<string>()
  const [selection, setSelection] = useState<{ quote: string; section: number | null; anchor: { x: number; y: number } } | null>(null)

  const tree = useMemo(() => buildTree(codebase.files), [codebase.files])
  const notes = useMemo(() => {
    const byPath = new Map<string, { note: string; weight?: string }>()
    for (const folder of map?.folders ?? []) byPath.set(folder.path, { note: folder.note })
    for (const entry of map?.files ?? []) byPath.set(entry.path, entry)
    return byPath
  }, [map])
  const tourStop = useMemo(() => new Map((map?.tour ?? []).map((stop, i) => [stop.path, i + 1])), [map])

  // Claude maps the repository the first time it is opened.
  useEffect(() => {
    if (map) return
    if (!hasKey) return setProblem('Add your Anthropic API key to have this repository explained.')
    let cancelled = false
    setProblem(undefined)
    mapCodebase(codebase).then(
      (written) => !cancelled && setMap(written),
      (error) => {
        console.error(error)
        if (!cancelled) setProblem(explain(error, 'The repository could not be read. Try again.'))
      },
    )
    return () => {
      cancelled = true
    }
  }, [codebase, map, hasKey, attempt])

  // Open the folders that lead to the files to read first.
  useEffect(() => {
    if (!map) return
    const open = new Set<string>()
    for (const stop of map.tour) {
      const parts = stop.path.split('/')
      for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join('/'))
    }
    setExpanded(open)
  }, [map])

  const openFile = async (path: string) => {
    setShowTree(false)
    setChat(null)
    setFile({ path, code: null, sections: null, working: true })
    window.scrollTo({ top: 0 })
    const update = (next: Partial<OpenFile>) => setFile((current) => (current?.path === path ? { ...current, ...next } : current))
    let code: string
    try {
      code = await fileText(codebase, path)
      update({ code })
    } catch (error) {
      return update({ working: false, problem: explain(error, 'That file could not be read from GitHub.') })
    }
    if (demo) return update({ sections: demo[path] ?? null, working: false })
    if (!map || !hasKey) return update({ working: false })
    try {
      update({ sections: await fileSections(codebase, map, path, code), working: false })
    } catch (error) {
      console.error(error)
      update({ working: false, problem: explain(error, 'The notes for this file could not be written. Try again.') })
    }
  }

  // Offer to ask about whatever is selected in the open file.
  useEffect(() => {
    const update = () => {
      const picked = document.getSelection()
      if (!picked || picked.isCollapsed || picked.rangeCount === 0) return setSelection(null)
      const range = picked.getRangeAt(0)
      const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
      const quote = picked.toString().trim().slice(0, 2000)
      if (!start?.closest('.code-main') || !quote) return setSelection(null)
      const within = start.closest<HTMLElement>('[data-section]')
      const rects = range.getClientRects()
      const last = rects[rects.length - 1]
      if (!last) return setSelection(null)
      setSelection({ quote, section: within ? Number(within.dataset.section) : null, anchor: { x: last.right, y: last.bottom } })
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])

  const chatSection = chat?.subject?.section != null ? (file?.sections?.[chat.subject.section] ?? null) : null
  const replaceSection = (index: number, next: Section) => {
    if (!file?.sections) return
    const sections = file.sections.map((section, i) => (i === index ? next : section))
    setFile({ ...file, sections })
    if (!demo) void saveSections(codebase.id, file.path, sections)
  }

  const ask = async (question: string) => {
    if (!chat || !map || asking) return
    const history = chat.lines.filter(isTurn)
    const asked: Turn = { role: 'user', text: question }
    setAskProblem(undefined)
    setAsking(true)
    setChat({ ...chat, lines: [...chat.lines, asked] })
    try {
      const numbered = file?.code?.split('\n').map((line, i) => `${i + 1}\t${line}`).join('\n').slice(0, 80_000)
      const note = chatSection?.kind === 'summary' ? { bullets: chatSection.bullets, caveat: null } : undefined
      const reply = await invokeClaude<{ answer: string; note: { bullets: string[] } | null }>('ask', {
        brief: mapAsText(codebase, map),
        context: numbered ? `The file they have open, ${file!.path}:\n${numbered}` : 'No file is open.',
        quote: chat.subject?.quote ?? '',
        history,
        question,
        note,
      })
      const added: Line[] = [{ role: 'claude', text: reply.answer }]
      if (reply.note && chatSection && chat.subject?.section != null) {
        added.push({ role: 'edit', undone: false, before: chatSection })
        replaceSection(chat.subject.section, { ...chatSection, bullets: reply.note.bullets })
      }
      setChat((current) => current && { ...current, lines: [...current.lines, ...added] })
    } catch (error) {
      console.error(error)
      // Take the unanswered question back out, so the conversation still alternates.
      setChat((current) => current && { ...current, lines: current.lines.filter((line) => line !== asked) })
      setAskProblem(explain(error, 'Something went wrong. Check your connection and ask again.'))
    } finally {
      setAsking(false)
    }
  }

  const toggle = (path: string) => {
    const next = new Set(expanded)
    if (!next.delete(path)) next.add(path)
    setExpanded(next)
  }

  const row = (node: TreeNode, depth: number): React.ReactNode => {
    const about = notes.get(node.path)
    const indent = { paddingLeft: 8 + depth * 14 }
    if (!node.file) {
      const open = expanded.has(node.path)
      return (
        <li key={node.path}>
          <button type="button" className="tree-row tree-folder" style={indent} aria-expanded={open} onClick={() => toggle(node.path)}>
            <span className="tree-name">
              {open ? '▾' : '▸'} {node.name}
            </span>
            {about && <span className="tree-note">{about.note}</span>}
          </button>
          {open && <ul>{node.children.map((child) => row(child, depth + 1))}</ul>}
        </li>
      )
    }
    // Files that cannot usefully be read are a line of text, not something to open.
    const stand = placeholder(node.file)
    if (stand) {
      return (
        <li key={node.path} className="tree-row tree-placeholder" style={indent}>
          <span className="tree-name">{node.name}</span>
          <span className="tree-note">{stand}</span>
        </li>
      )
    }
    const stop = tourStop.get(node.path)
    return (
      <li key={node.path}>
        <button
          type="button"
          className={`tree-row${about?.weight === 'skip' ? ' tree-skip' : ''}`}
          style={indent}
          aria-current={file?.path === node.path}
          onClick={() => void openFile(node.path)}
        >
          <span className="tree-name">
            {stop && <span className="tree-stop">{stop}</span>}
            {node.name}
          </span>
          {about && <span className="tree-note">{about.note}</span>}
        </button>
      </li>
    )
  }

  const name = `${codebase.owner}/${codebase.repo}`
  return (
    <>
      <header className="toolbar">
        {onClose && (
          <button type="button" className="button" onClick={onClose}>
            ← Library
          </button>
        )}
        <button type="button" className="button tree-toggle" aria-pressed={showTree} onClick={() => setShowTree(!showTree)}>
          Files
        </button>
        <span className="title">{file ? file.path : name}</span>
        {file && (
          <button type="button" className="button" onClick={() => setFile(null)}>
            Overview
          </button>
        )}
        {file?.sections && (
          <button type="button" className="button" aria-pressed={summarise} onClick={() => setSummarise(!summarise)}>
            {summarise ? 'Show all code' : 'Fold code'}
          </button>
        )}
        {map && (
          <button type="button" className="button" aria-pressed={chat?.subject === null} onClick={() => setChat({ subject: null, lines: [] })}>
            Ask ✦
          </button>
        )}
      </header>

      <div className={`code-layout${showTree ? ' show-tree' : ''}${chat ? ' beside-chat' : ''}`}>
        <nav className="tree" aria-label="Files">
          <ul>{tree.map((node) => row(node, 0))}</ul>
        </nav>

        <main className="code-main">
          {!file && !map && (
            <p className="notice">
              {problem ?? 'Reading the repository…'}{' '}
              {problem && hasKey && (
                <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
                  Retry
                </button>
              )}
            </p>
          )}
          {!file && map && (
            <article className="overview">
              <h1>{name}</h1>
              <p>{map.summary}</p>
              <p className="chips">
                {map.stack.map((item) => (
                  <span key={item} className="chip">
                    {item}
                  </span>
                ))}
              </p>
              <h2>How it fits together</h2>
              <div className="parts">
                {map.parts.map((part) => (
                  <section key={part.name}>
                    <h3>{part.name}</h3>
                    <p>{part.role}</p>
                    <p className="muted">{part.paths.join(' · ')}</p>
                  </section>
                ))}
              </div>
              <h2>What happens, step by step</h2>
              <ol>
                {map.flow.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <h2>Start here</h2>
              <ol className="tour">
                {map.tour.map((stop) => (
                  <li key={stop.path}>
                    <button type="button" onClick={() => void openFile(stop.path)}>
                      {stop.path}
                    </button>
                    <span>{stop.why}</span>
                  </li>
                ))}
              </ol>
            </article>
          )}
          {file && (
            <>
              {notes.get(file.path) && <p className="file-about">{notes.get(file.path)!.note}</p>}
              {file.working && <p className="notice">{file.code === null ? 'Opening…' : 'Writing notes for this file…'}</p>}
              {file.problem && <p className="error">{file.problem}</p>}
              {file.code !== null && (
                <FileView path={file.path} code={file.code} sections={file.sections} summarise={summarise} asking={chat?.subject?.section ?? null} />
              )}
            </>
          )}
        </main>
      </div>

      {selection && map && !(chat && selection.quote === chat.subject?.quote) && (
        <div
          className="selection-bar"
          style={{
            left: Math.max(8, Math.min(selection.anchor.x - 40, window.innerWidth - 96)),
            top: Math.min(selection.anchor.y + 8, window.innerHeight - 48),
          }}
          // Keep the text selected while the button is pressed.
          onPointerDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            onClick={() => {
              setAskProblem(undefined)
              setChat({ subject: { quote: selection.quote, section: selection.section }, lines: [] })
            }}
          >
            Ask ✦
          </button>
        </div>
      )}

      {chat && (
        <AskPanel
          whole="project"
          subject={chat.subject && { quote: chat.subject.quote, area: false, page: 0 }}
          hasNote={chatSection?.kind === 'summary'}
          lines={chat.lines}
          asking={asking}
          problem={askProblem}
          unavailable={hasKey || demo ? undefined : 'Add your Anthropic API key to ask questions.'}
          onAsk={(question) => void ask(question)}
          onUndo={(index) => {
            const line = chat.lines[index]
            if (!line || line.role !== 'edit' || chat.subject?.section == null) return
            replaceSection(chat.subject.section, line.before)
            setChat({ ...chat, lines: chat.lines.map((l, i) => (i === index ? { ...line, undone: true } : l)) })
          }}
          onClose={() => setChat(null)}
        />
      )}
    </>
  )
}
