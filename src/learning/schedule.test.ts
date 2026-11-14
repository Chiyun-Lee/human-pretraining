import { describe, expect, it } from 'vitest'
import { recall, review, type Schedule, streak } from './schedule'

const fresh: Schedule = { stability: 0, difficulty: 0, reps: 0, lapses: 0, last_review: null, due: '2026-01-01T00:00:00Z' }
const at = (day: number) => new Date(Date.UTC(2026, 0, day, 12))
const daysUntilDue = (card: Schedule, now: Date) => Math.round((new Date(card.due).getTime() - now.getTime()) / 86_400_000)

describe('review', () => {
  it('recall is 90% after one stability', () => {
    expect(recall(10, 10)).toBeCloseTo(0.9, 5)
    expect(recall(10, 0)).toBe(1)
  })

  it('first answers use the default starting stabilities', () => {
    const good = review(fresh, 3, at(1))
    expect(good.stability).toBeCloseTo(2.3065)
    expect(daysUntilDue(good, at(1))).toBe(2)
    expect(good.reps).toBe(1)

    const forgot = review(fresh, 1, at(1))
    expect(daysUntilDue(forgot, at(1))).toBe(1)
    expect(forgot.lapses).toBe(0) // never known, so not a lapse
  })

  it('intervals grow with each success and shrink after forgetting', () => {
    let card = review(fresh, 3, at(1))
    const intervals: number[] = []
    let day = 1
    for (let i = 0; i < 4; i++) {
      day += daysUntilDue(card, at(day))
      card = review(card, 3, at(day))
      intervals.push(daysUntilDue(card, at(day)))
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1]!)
    expect(intervals.at(-1)).toBeGreaterThan(30)

    const before = card.stability
    day += daysUntilDue(card, at(day))
    const lapsed = review(card, 1, at(day))
    expect(lapsed.stability).toBeLessThan(before / 3)
    expect(lapsed.lapses).toBe(1)
    expect(lapsed.difficulty).toBeGreaterThan(card.difficulty)
  })

  it('a partly right answer earns a shorter wait than a right one', () => {
    const card = review(fresh, 3, at(1))
    expect(review(card, 2, at(4)).stability).toBeLessThan(review(card, 3, at(4)).stability)
  })

  it('keeps difficulty between 1 and 10', () => {
    let card = review(fresh, 1, at(1))
    for (let day = 2; day < 30; day++) card = review(card, 1, at(day))
    expect(card.difficulty).toBeLessThanOrEqual(10)
    expect(card.stability).toBeGreaterThan(0)
  })
})

describe('streak', () => {
  const today = new Date(2026, 5, 10, 9)
  it('counts back from today', () => expect(streak(['2026-06-10', '2026-06-09', '2026-06-08', '2026-06-06'], today)).toBe(3))
  it('still stands if today is not done yet', () => expect(streak(['2026-06-09', '2026-06-08'], today)).toBe(2))
  it('is broken by a missed day', () => expect(streak(['2026-06-08'], today)).toBe(0))
})
