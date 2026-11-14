// Finds the citations and defined terms in a page's text, so each can be
// given a card. Pure, so it is unit-tested.
import type { Reference } from '../library/bibliography'
import type { TextBox } from '../pdf/blocks'
import type { Box } from '../pdf/figures'
import { findInBoxes } from '../pdf/locate'

export interface Term {
  term: string
  meaning: string
}

export interface CitationMark {
  box: Box
  refs: Reference[]
}

export interface TermMark {
  box: Box
  term: Term
}

/** "3, 5-7" -> [3, 5, 6, 7] */
export function citedNumbers(list: string): number[] {
  const numbers: number[] = []
  for (const part of list.split(/[,;]/)) {
    const [from, to] = part.split(/[-–—]/).map((value) => Number.parseInt(value, 10))
    if (!from) continue
    const last = to && to >= from && to - from < 30 ? to : from
    for (let n = from; n <= last; n++) numbers.push(n)
  }
  return numbers
}

const NUMBERED = /\[(\d{1,3}(?:\s*[,;–—-]\s*\d{1,3})*)\]/g
// "Vaswani et al., 2017", "Bahdanau and Cho (2014)", "(Smith & Jones, 2020a)"
const AUTHOR_YEAR = /(\p{Lu}[\p{L}'’-]+)(?:\s+et\s+al\.?|\s+(?:and|&)\s+\p{Lu}[\p{L}'’-]+)?,?\s+\(?((?:19|20)\d{2})[a-z]?\b/gu

const plain = (text: string) => text.normalize('NFKD').replace(/[^\p{L}]/gu, '').toLowerCase()

/** The references a page's citation markers point to. Markers that match no reference are left out. */
export function findCitations(boxes: TextBox[], refs: Reference[]): CitationMark[] {
  if (refs.length === 0) return []
  const marks: CitationMark[] = []

  for (const { match, box } of findInBoxes(boxes, NUMBERED)) {
    // A marker at the very start of a line is an entry of the reference list itself.
    if (match.index === 0) continue
    const cited = citedNumbers(match[1]!).map((n) => refs[n - 1]).filter((ref): ref is Reference => ref !== undefined)
    if (cited.length > 0) marks.push({ box, refs: cited })
  }

  for (const { match, box } of findInBoxes(boxes, AUTHOR_YEAR)) {
    const family = plain(match[1]!)
    const year = Number(match[2])
    const cited = refs.filter((ref) => {
      if (ref.year !== year) return false
      const first = ref.author ? plain(ref.author.split(/[\s,]/)[0]!) : null
      return first ? first === family : plain(ref.text ?? '').startsWith(family)
    })
    // Two papers by the same first author in one year cannot be told apart from the text.
    if (cited.length === 1) marks.push({ box, refs: cited })
  }
  return marks
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A matcher for the given terms (whole words; short or capitalised terms only in their exact case). */
export function termMatcher(terms: Term[]): { pattern: RegExp; lookup: (found: string) => Term | undefined } | null {
  const usable = terms.filter((t) => t.term.trim().length >= 2)
  if (usable.length === 0) return null
  const byLower = new Map(usable.map((t) => [t.term.trim().toLowerCase(), t]))
  const words = [...byLower.keys()].sort((a, b) => b.length - a.length).map(escape)
  return {
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'giu'),
    lookup: (found) => {
      const term = byLower.get(found.toLowerCase())
      if (!term) return undefined
      const exact = term.term.trim()
      const strict = exact.length <= 4 || exact === exact.toUpperCase()
      return strict && found !== exact ? undefined : term
    },
  }
}

/** The first place each term appears on a page. */
export function findTerms(boxes: TextBox[], terms: Term[]): TermMark[] {
  const matcher = termMatcher(terms)
  if (!matcher) return []
  const seen = new Set<Term>()
  const marks: TermMark[] = []
  for (const { match, box } of findInBoxes(boxes, matcher.pattern)) {
    const term = matcher.lookup(match[0])
    if (!term || seen.has(term)) continue
    seen.add(term)
    marks.push({ box, term })
  }
  return marks
}

/** Splits a note's text into plain runs and the terms within it. */
export function splitTerms(text: string, terms: Term[]): (string | { text: string; term: Term })[] {
  const matcher = termMatcher(terms)
  if (!matcher) return [text]
  const parts: (string | { text: string; term: Term })[] = []
  let at = 0
  for (const match of text.matchAll(matcher.pattern)) {
    const term = matcher.lookup(match[0])
    if (!term) continue
    if (match.index > at) parts.push(text.slice(at, match.index))
    parts.push({ text: match[0], term })
    at = match.index + match[0].length
  }
  if (at < text.length) parts.push(text.slice(at))
  return parts
}
