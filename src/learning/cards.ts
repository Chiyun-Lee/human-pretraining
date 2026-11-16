// The questions about each paper and the reader's progress through them.
import { supabase } from '../lib/supabase'
import type { PdfDocument } from '../pdf/pdfjs'
import { invokeClaude } from '../summaries/invoke'
import type { Brief } from '../summaries/slide'
import { paperText } from '../summaries/summarise'
import { type Grade, localDay, review, type Schedule, streak } from './schedule'

export interface Card extends Schedule {
  id: string
  paper_id: string
  kind: 'recall' | 'explain' | 'apply' | 'critique'
  prompt: string
  /** Four choices, or empty when the answer is written. */
  options: string[]
  correct: number
  answer: string
  points: string[]
  page: number | null
  /** What the reader last answered; null until they have answered it. */
  last_response: string | null
  /** Present when cards from several papers are listed together. */
  papers?: { title: string } | null
}

const COLUMNS =
  'id, paper_id, kind, prompt, options, correct, answer, points, page, due, stability, difficulty, reps, lapses, last_review, last_response'

export async function listPaperCards(paperId: string): Promise<Card[]> {
  const { data, error } = await supabase.from('cards').select(COLUMNS).eq('paper_id', paperId).order('created_at')
  if (error) throw error
  return data as Card[]
}

/** Cards from every paper that have been answered before and are due again. */
export async function listDueCards(): Promise<Card[]> {
  const { data, error } = await supabase
    .from('cards')
    .select(`${COLUMNS}, papers(title)`)
    .gt('reps', 0)
    .lte('due', new Date().toISOString())
    .order('due')
    .limit(40)
  if (error) throw error
  return data as unknown as Card[]
}

/** Has Claude write a paper's questions, and saves them. */
export async function createCards(doc: PdfDocument, paperId: string, brief: Brief): Promise<Card[]> {
  const { questions } = await invokeClaude<{ questions: Omit<Card, 'id' | 'paper_id' | keyof Schedule>[] }>('quiz', {
    brief,
    text: await paperText(doc),
  })
  const rows = questions.map(({ kind, prompt, options, correct, answer, points, page }) => ({
    paper_id: paperId,
    kind,
    prompt,
    options,
    correct,
    answer,
    points,
    page: page && page <= doc.numPages ? page : null,
  }))
  const { data, error } = await supabase.from('cards').insert(rows).select(COLUMNS)
  if (error) throw error
  return data as Card[]
}

export interface Verdict {
  verdict: 'right' | 'partly' | 'wrong'
  feedback: string
}

export const GRADES: Record<Verdict['verdict'], Grade> = { right: 3, partly: 2, wrong: 1 }

/** Claude's judgement of a written answer. */
export function judge(card: Card, response: string): Promise<Verdict> {
  const { prompt, answer, points } = card
  return invokeClaude<Verdict>('quiz', { judge: { prompt, answer, points }, response })
}

/** Records an answer: reschedules the card and counts it towards today. */
export async function answerCard(card: Card, grade: Grade, response: string): Promise<Card> {
  const next = { ...review(card, grade), last_response: response }
  const { error } = await supabase.from('cards').update(next).eq('id', card.id)
  if (error) throw error
  const counted = await supabase.rpc('record_study', { p_day: localDay(), p_reviews: 1 })
  if (counted.error) console.error(counted.error)
  return { ...card, ...next }
}

export async function deleteCard(id: string): Promise<void> {
  const { error } = await supabase.from('cards').delete().eq('id', id)
  if (error) throw error
}

export interface StudyStats {
  streak: number
  studiedToday: boolean
  due: number
}

export async function fetchStudyStats(): Promise<StudyStats> {
  const [days, due] = await Promise.all([
    supabase.from('study_days').select('day').order('day', { ascending: false }).limit(400),
    supabase.from('cards').select('id', { count: 'exact', head: true }).gt('reps', 0).lte('due', new Date().toISOString()),
  ])
  if (days.error) throw days.error
  if (due.error) throw due.error
  const studied = days.data.map((row) => row.day as string)
  return { streak: streak(studied), studiedToday: studied.includes(localDay()), due: due.count ?? 0 }
}
