import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { addCodebase, type Codebase, deleteCodebase, listCodebases } from '../code/codebases'
import { parseRepo } from '../code/github'
import { byline, toBibtex } from './bibliography'
import { type Card, fetchStudyStats, listDueCards, type StudyStats } from '../learning/cards'
import { Quiz } from '../learning/Quiz'
import { addPaper, addPaperFromLink, deletePaper, listPapers, type Paper } from './papers'

interface Props {
  userId: string
  onOpen: (paper: Paper) => void
  onOpenCode: (codebase: Codebase) => void
}

export function Library({ userId, onOpen, onOpenCode }: Props) {
  const [papers, setPapers] = useState<Paper[] | null>(null)
  const [codebases, setCodebases] = useState<Codebase[]>([])
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<StudyStats | null>(null)
  const [reviewing, setReviewing] = useState<Card[] | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [listed, code] = await Promise.all([listPapers(), listCodebases()])
      setPapers(listed)
      setCodebases(code)
    } catch {
      setError('Could not load your library. Check your connection.')
    }
    fetchStudyStats().then(setStats, console.error)
  }, [])

  // Reload when the app comes back to the foreground, so changes made on
  // another device show up.
  useEffect(() => {
    void refresh()
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const add = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await addPaper(userId, file)
      await refresh()
    } catch {
      setError('That PDF could not be uploaded. Files must be PDFs under 50 MB.')
    } finally {
      setBusy(false)
    }
  }

  const addLink = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // A GitHub address is a codebase; anything else is a paper.
      if (parseRepo(link)) await addCodebase(link)
      else await addPaperFromLink(link)
      setLink('')
      await refresh()
    } catch (problem) {
      setError((problem as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const exportBibtex = () => {
    const file = new Blob([toBibtex(papers ?? [])], { type: 'application/x-bibtex' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(file)
    link.download = 'library.bib'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const removeCode = async (codebase: Codebase) => {
    if (!confirm(`Remove ${codebase.owner}/${codebase.repo} from your library?`)) return
    try {
      await deleteCodebase(codebase.id)
      await refresh()
    } catch {
      setError('That codebase could not be removed.')
    }
  }

  const remove = async (paper: Paper) => {
    if (!confirm(`Remove “${paper.title}” from your library?`)) return
    try {
      await deletePaper(paper)
      await refresh()
    } catch {
      setError('That paper could not be removed.')
    }
  }

  const startReview = async () => {
    try {
      setReviewing(await listDueCards())
    } catch {
      setError('Your review questions could not be loaded.')
    }
  }

  return (
    <main
      className="library"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        void add(event.dataTransfer.files[0])
      }}
    >
      <form className="add-row" onSubmit={(event) => void addLink(event)}>
        <input
          className="input"
          placeholder="Paste a paper URL, DOI, arXiv ID or GitHub repository"
          aria-label="Paper URL, DOI, arXiv ID or GitHub repository"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          value={link}
          disabled={busy}
          onChange={(event) => setLink(event.target.value)}
        />
        <button type="submit" className="button primary" disabled={busy || link.trim() === ''}>
          {busy ? 'Adding…' : 'Add'}
        </button>
        <label className={busy ? 'button disabled' : 'button'}>
          Add PDF
          <input type="file" accept="application/pdf" hidden disabled={busy} onChange={(event) => void add(event.target.files?.[0])} />
        </label>
        {papers && papers.length > 0 && (
          <button type="button" className="button" onClick={exportBibtex}>
            Export BibTeX
          </button>
        )}
      </form>
      {stats && (stats.due > 0 || stats.streak > 0) && (
        <div className="study">
          {stats.streak > 0 && (
            <span className={stats.studiedToday ? 'streak' : 'streak pending'} title={stats.studiedToday ? undefined : 'Answer one question today to keep it'}>
              {stats.streak}-day streak
            </span>
          )}
          <span className="muted">
            {stats.due > 0 ? `${stats.due} question${stats.due === 1 ? '' : 's'} due for review` : 'Nothing due for review'}
          </span>
          {stats.due > 0 && (
            <button type="button" className="button primary" onClick={() => void startReview()}>
              Review
            </button>
          )}
        </div>
      )}
      {reviewing && (
        <Quiz
          title="Review"
          cards={reviewing}
          onClose={() => {
            setReviewing(null)
            void refresh()
          }}
        />
      )}
      {error && <p className="error">{error}</p>}
      {papers === null && !error && <p className="notice">Loading…</p>}
      {papers?.length === 0 && codebases.length === 0 && <p className="notice">Nothing here yet. Paste a link above, add a PDF, or drop one here.</p>}
      <ul className="paper-list">
        {codebases.map((codebase) => (
          <li key={codebase.id}>
            <button type="button" className="paper" onClick={() => onOpenCode(codebase)}>
              <span className="paper-title">
                {codebase.owner}/{codebase.repo}
              </span>
              <span className="paper-date">Codebase · {codebase.files.length} files</span>
            </button>
            <button type="button" className="button" aria-label={`Remove ${codebase.repo}`} onClick={() => void removeCode(codebase)}>
              Remove
            </button>
          </li>
        ))}
        {papers?.map((paper) => (
          <li key={paper.id}>
            <button type="button" className="paper" onClick={() => onOpen(paper)}>
              <span className="paper-title">{paper.title}</span>
              <span className="paper-date">{byline(paper.meta) || `Added ${new Date(paper.created_at).toLocaleDateString()}`}</span>
            </button>
            <button type="button" className="button" aria-label={`Remove ${paper.title}`} onClick={() => void remove(paper)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
