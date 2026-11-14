import { describe, expect, it } from 'vitest'
import { type Question, usable } from '../../supabase/functions/quiz/claude.ts'

const base: Question = { kind: 'recall', prompt: 'Q?', options: ['a', 'b', 'c', 'd'], correct: 2, answer: 'c', points: [], page: 3 }

describe('usable', () => {
  it('keeps well-formed questions', () => {
    const written: Question = { ...base, kind: 'explain', options: [], correct: 0, points: ['one', 'two'] }
    expect(usable([base, written])).toEqual([base, written])
  })

  it('drops multiple choice without four distinct options or a valid answer', () => {
    expect(usable([{ ...base, options: ['a', 'b', 'c'] }])).toEqual([])
    expect(usable([{ ...base, options: ['a', 'a', 'c', 'd'] }])).toEqual([])
    expect(usable([{ ...base, correct: 4 }])).toEqual([])
  })

  it('drops written questions with nothing to judge against', () => {
    expect(usable([{ ...base, kind: 'apply', options: [], points: [] }])).toEqual([])
  })

  it('treats options on a written question as a mistake and ignores them', () => {
    const [q] = usable([{ ...base, kind: 'critique', points: ['p'], page: -1 }])
    expect(q).toMatchObject({ options: [], correct: 0, page: 0 })
  })
})
