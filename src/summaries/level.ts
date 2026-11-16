// Who a paper's notes are written for. Each paper is written at one level;
// the last one chosen is remembered in this browser for papers not yet read.

export type Level = 'lay' | 'technical' | 'expert'

export const LEVELS: Record<Level, { name: string; about: string }> = {
  lay: { name: 'Lay', about: 'For anyone: everyday words, jargon explained or replaced' },
  technical: { name: 'Technical', about: 'For technical people from a neighbouring field: its jargon explained, methods kept' },
  expert: { name: 'Expert', about: 'For people in the field: dense, jargon and all' },
}

const isLevel = (value: unknown): value is Level => typeof value === 'string' && value in LEVELS
const KEY = 'level'

export function preferredLevel(): Level {
  try {
    const stored = localStorage.getItem(KEY)
    if (isLevel(stored)) return stored
  } catch {
    // Storage is unavailable in some private windows; the default is fine.
  }
  return 'technical'
}

export function rememberLevel(level: Level): void {
  try {
    localStorage.setItem(KEY, level)
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

/** The level a paper was written at, or the reader's usual one if it has not been written yet. */
export const levelOf = (stored: unknown): Level => (isLevel(stored) ? stored : preferredLevel())
