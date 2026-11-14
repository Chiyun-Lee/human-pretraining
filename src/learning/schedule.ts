// When a card should next be asked. This is FSRS-6 with its published default
// weights (github.com/open-spaced-repetition): each card has a stability (the
// number of days after which recall is 90% likely) and a difficulty from 1 to
// 10, and is next due once recall is expected to have fallen to 90%.

export type Grade = 1 | 2 | 3 | 4 // forgot, hard (partly right), good, easy

export interface Schedule {
  stability: number
  difficulty: number
  reps: number
  lapses: number
  last_review: string | null
  due: string
}

const W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
  1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
] as const
const DAY = 86_400_000
const DECAY = -W[20]
const FACTOR = 0.9 ** (1 / DECAY) - 1

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)
const firstDifficulty = (grade: Grade) => clamp(W[4] - Math.exp(W[5] * (grade - 1)) + 1, 1, 10)

/** The chance the card is still remembered `days` after its last review. */
export function recall(stability: number, days: number): number {
  return (1 + (FACTOR * days) / stability) ** DECAY
}

/** The card's schedule after it is answered at `now`. */
export function review(card: Schedule, grade: Grade, now = new Date()): Schedule {
  let { stability, difficulty } = card
  const lapses = card.lapses + (grade === 1 && card.last_review ? 1 : 0)

  if (!card.last_review || stability <= 0) {
    stability = W[grade - 1]!
    difficulty = firstDifficulty(grade)
  } else {
    const days = Math.max(0, Math.floor((now.getTime() - new Date(card.last_review).getTime()) / DAY))
    const r = recall(stability, days)
    const d = difficulty
    if (days === 0) {
      const change = Math.exp(W[17] * (grade - 3 + W[18])) * stability ** -W[19]
      stability *= grade >= 2 ? Math.max(change, 1) : change
    } else if (grade === 1) {
      stability = Math.min(
        W[11] * d ** -W[12] * ((stability + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r)),
        stability / Math.exp(W[17] * W[18]),
      )
    } else {
      const bonus = (grade === 2 ? W[15] : 1) * (grade === 4 ? W[16] : 1)
      stability *= 1 + Math.exp(W[8]) * (11 - d) * stability ** -W[9] * (Math.exp(W[10] * (1 - r)) - 1) * bonus
    }
    const moved = d + (-W[6] * (grade - 3) * (10 - d)) / 9
    difficulty = clamp(W[7] * firstDifficulty(4) + (1 - W[7]) * moved, 1, 10)
  }
  stability = Math.max(stability, 0.001)

  // A forgotten card comes back tomorrow; otherwise wait until recall has dropped to 90%.
  const interval = grade === 1 ? 1 : clamp(Math.round(stability), 1, 36_500)
  return {
    stability,
    difficulty,
    reps: card.reps + 1,
    lapses,
    last_review: now.toISOString(),
    due: new Date(now.getTime() + interval * DAY).toISOString(),
  }
}

/** A calendar date in the reader's own time zone, as YYYY-MM-DD. */
export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** How many days in a row end today, or yesterday if today has not been studied yet. */
export function streak(days: string[], today = new Date()): number {
  const studied = new Set(days)
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!studied.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1)
  let count = 0
  while (studied.has(localDay(cursor))) {
    count++
    cursor.setDate(cursor.getDate() - 1)
  }
  return count
}
