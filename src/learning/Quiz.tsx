import { useState } from 'react'
import { ClaudeError } from '../summaries/invoke'
import { answerCard, type Card, deleteCard, GRADES, judge, saveGuess, type Verdict } from './cards'
import type { Grade } from './schedule'

interface Props {
  title: string
  cards: Card[]
  /** Guesses before reading: nothing is marked or scheduled, and the answers are not shown. */
  predict?: boolean
  /** Shown in the page rather than over it. */
  inline?: boolean
  onChanged?: (card: Card) => void
  onRemoved?: (id: string) => void
  onClose: () => void
}

const KIND: Record<Card['kind'], string> = {
  predict: 'The main idea',
  recall: 'Recall',
  explain: 'Explain',
  apply: 'Apply it',
  critique: 'Weigh it up',
}

type Outcome =
  | { state: 'answering' }
  | { state: 'checking' }
  | { state: 'guessed' }
  /** `verdict` is missing when Claude could not judge and the reader marks their own answer. */
  | { state: 'marked'; grade?: Grade; verdict?: Verdict; problem?: string }

/** Asks a set of cards one at a time; a card that was missed comes round once more at the end. */
export function Quiz({ title, cards, predict, inline, onChanged, onRemoved, onClose }: Props) {
  const [queue, setQueue] = useState(cards)
  const [position, setPosition] = useState(0)
  const [outcome, setOutcome] = useState<Outcome>({ state: 'answering' })
  const [response, setResponse] = useState('')
  const [picked, setPicked] = useState<number | null>(null)
  const [right, setRight] = useState(0)
  /** Cards already scored this session: seeing one again is practice only. */
  const [scored, setScored] = useState<Set<string>>(new Set())

  const card = queue[position]
  const shell = inline ? 'quiz quiz-inline' : 'quiz'

  if (!card) {
    return (
      <section className={shell} role="dialog" aria-label={title}>
        <div className="quiz-card">
          <h2>{cards.length === 0 ? 'Nothing to review right now' : predict ? 'Guesses in' : `${right} of ${cards.length} right`}</h2>
          <p className="muted">
            {cards.length === 0
              ? 'Questions come back when you are about to forget them.'
              : predict
                ? 'Now read on and see how you did.'
                : 'Each question returns just before you would forget it: sooner if you missed it, later if you knew it.'}
          </p>
          <div className="row">
            <button type="button" className="button primary" onClick={onClose}>
              {predict ? 'Start reading' : 'Done'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  const record = async (grade: Grade, given: string, verdict?: Verdict) => {
    setOutcome({ state: 'marked', grade, verdict })
    if (scored.has(card.id)) return
    setScored(new Set(scored).add(card.id))
    if (grade >= 3) setRight((n) => n + 1)
    // Missed cards are asked again before the session ends.
    if (grade === 1) setQueue((current) => [...current, card])
    try {
      onChanged?.(await answerCard(card, grade, given))
    } catch (error) {
      console.error(error)
      setOutcome({ state: 'marked', grade, verdict, problem: 'This answer could not be saved. Check your connection.' })
    }
  }

  const pick = (index: number) => {
    if (outcome.state !== 'answering') return
    setPicked(index)
    const given = card.options[index] ?? ''
    if (predict) {
      setOutcome({ state: 'guessed' })
      void saveGuess(card, given)
      onChanged?.({ ...card, last_response: given })
    } else {
      void record(index === card.correct ? 3 : 1, given)
    }
  }

  const check = async () => {
    setOutcome({ state: 'checking' })
    try {
      const verdict = await judge(card, response)
      await record(GRADES[verdict.verdict], response, verdict)
    } catch (error) {
      console.error(error)
      // Fall back to showing the answer and letting the reader mark themselves.
      setOutcome({ state: 'marked', problem: error instanceof ClaudeError ? error.message : 'Claude could not check this one.' })
    }
  }

  const next = () => {
    setPosition(position + 1)
    setOutcome({ state: 'answering' })
    setResponse('')
    setPicked(null)
  }

  const remove = async () => {
    try {
      await deleteCard(card.id)
      onRemoved?.(card.id)
      setQueue((current) => current.filter((c) => c.id !== card.id))
      setOutcome({ state: 'answering' })
      setResponse('')
      setPicked(null)
    } catch (error) {
      console.error(error)
    }
  }

  const choice = card.options.length > 0
  const marked = outcome.state === 'marked'
  const verdict = marked ? outcome.verdict?.verdict : undefined
  const grade = marked ? outcome.grade : undefined

  return (
    <section className={shell} role="dialog" aria-label={title}>
      <div className="quiz-card">
        <header>
          <span className="quiz-kind">{predict ? 'Before you read: take a guess' : KIND[card.kind]}</span>
          <span className="muted">
            {Math.min(position + 1, queue.length)} / {queue.length}
          </span>
          <button type="button" className="button" onClick={onClose}>
            {predict ? 'Skip' : 'Close'}
          </button>
        </header>
        {card.papers?.title && <p className="muted quiz-paper">{card.papers.title}</p>}
        <h2>{card.prompt}</h2>

        {choice ? (
          <div className="quiz-options">
            {card.options.map((option, i) => {
              const shown = marked && i === card.correct ? ' correct' : marked && i === picked ? ' incorrect' : ''
              return (
                <button
                  key={i}
                  type="button"
                  className={`quiz-option${i === picked ? ' picked' : ''}${shown}`}
                  disabled={outcome.state !== 'answering'}
                  onClick={() => pick(i)}
                >
                  {option}
                </button>
              )
            })}
          </div>
        ) : (
          <textarea
            className="input"
            rows={4}
            placeholder="Answer from memory, in your own words"
            aria-label="Your answer"
            autoFocus
            value={response}
            readOnly={outcome.state !== 'answering'}
            onChange={(event) => setResponse(event.target.value)}
          />
        )}

        {outcome.state === 'guessed' && (
          <p className="quiz-feedback">Noted. {card.page ? `You will find out around page ${card.page}.` : 'You will find out as you read.'}</p>
        )}

        {marked && (
          <div className="quiz-feedback">
            {grade !== undefined && (
              <strong className={grade >= 3 ? 'good' : grade === 2 ? 'partly' : 'bad'}>
                {grade >= 3 ? 'Right.' : grade === 2 ? 'Partly.' : 'Not quite.'}
              </strong>
            )}
            {outcome.verdict && <p>{outcome.verdict.feedback}</p>}
            {outcome.problem && <p className="error">{outcome.problem}</p>}
            <p>{card.answer}</p>
            {!choice && card.points.length > 0 && (
              <ul>
                {card.points.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            )}
            {card.page && <p className="muted">Page {card.page}</p>}
          </div>
        )}

        <div className="row">
          {!choice && outcome.state === 'answering' && (
            <>
              <button type="button" className="button primary" disabled={!response.trim()} onClick={() => void check()}>
                Check
              </button>
              <button type="button" className="button" onClick={() => void record(1, '')}>
                I don’t know
              </button>
            </>
          )}
          {outcome.state === 'checking' && <span className="muted">Claude is checking…</span>}
          {marked && grade === undefined && (
            <>
              <button type="button" className="button primary" onClick={() => void record(3, response)}>
                I had it
              </button>
              <button type="button" className="button" onClick={() => void record(2, response)}>
                Partly
              </button>
              <button type="button" className="button" onClick={() => void record(1, response)}>
                I missed it
              </button>
            </>
          )}
          {(outcome.state === 'guessed' || (marked && grade !== undefined)) && (
            <button type="button" className="button primary" autoFocus onClick={next}>
              {position + 1 < queue.length ? 'Next' : 'Finish'}
            </button>
          )}
          {/* Claude can be too strict; the reader has the last word. */}
          {marked && verdict && verdict !== 'right' && !scored.has(`${card.id}:override`) && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setScored(new Set(scored).add(`${card.id}:override`))
                setRight((n) => n + 1)
                setQueue((current) => current.filter((c, i) => i <= position || c.id !== card.id))
                setOutcome({ state: 'marked', grade: 3, verdict: outcome.verdict })
                void answerCard({ ...card }, 3, response).then(onChanged, console.error)
              }}
            >
              I was right
            </button>
          )}
          {!predict && (
            <button type="button" className="quiz-remove" onClick={() => void remove()}>
              Remove this question
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
