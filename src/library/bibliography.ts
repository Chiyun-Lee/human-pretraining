// Bibliographic records: read from Crossref (the DOI registry), and written
// out as BibTeX. The parsing and formatting are pure and unit-tested.

export interface PaperMeta {
  authors: string[]
  year: number | null
  venue: string | null
  volume?: string | null
  pages?: string | null
}

export interface Reference {
  doi: string | null
  title: string | null
  /** First author's family name, as Crossref lists it. */
  author: string | null
  year: number | null
  venue: string | null
  /** The citation as printed, when Crossref has nothing more structured. */
  text: string | null
}

export interface CrossrefRecord {
  title: string | null
  meta: PaperMeta
  refs: Reference[]
}

const clean = (value: unknown): string | null =>
  typeof value === 'string' ? value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null : null
const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value)
const year = (value: unknown): number | null => {
  const number = Number.parseInt(String(value ?? ''), 10)
  return number > 1500 && number < 2200 ? number : null
}

interface CrossrefAuthor {
  given?: string
  family?: string
  name?: string
}

/** Reads the `message` of a Crossref /works/{doi} reply. */
export function parseCrossref(message: Record<string, unknown>): CrossrefRecord {
  const authors = ((message.author as CrossrefAuthor[] | undefined) ?? [])
    .map((a) => clean(a.family ? [a.given, a.family].filter(Boolean).join(' ') : a.name))
    .filter((name): name is string => name !== null)
  const issued = (message.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0]?.[0]
  const refs = ((message.reference as Record<string, unknown>[] | undefined) ?? []).map((r) => ({
    doi: clean(r.DOI),
    title: clean(r['article-title']) ?? clean(r['volume-title']),
    author: clean(r.author),
    year: year(r.year),
    venue: clean(r['journal-title']),
    text: clean(r.unstructured),
  }))
  return {
    title: clean(first(message.title)),
    meta: {
      authors,
      year: year(issued),
      venue: clean(first(message['container-title'])),
      volume: clean(message.volume),
      pages: clean(message.page),
    },
    refs,
  }
}

export async function fetchCrossref(doi: string): Promise<CrossrefRecord | null> {
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
  if (!response.ok) return null
  return parseCrossref(((await response.json()) as { message: Record<string, unknown> }).message)
}

/** "Lee, Ünlü, White et al. · Bioinformatics 2024" */
export function byline(meta: PaperMeta | null): string {
  if (!meta) return ''
  const families = meta.authors.map((name) => name.split(' ').pop()!)
  const who = families.length > 3 ? `${families.slice(0, 3).join(', ')} et al.` : families.join(', ')
  return [who, [meta.venue, meta.year].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
}

export const referenceLine = (ref: Reference): string =>
  ref.title ? [ref.author && `${ref.author} et al.`, ref.year && `(${ref.year})`, ref.title, ref.venue].filter(Boolean).join(' ') : (ref.text ?? ref.doi ?? '')

const escapeBibtex = (value: string) => value.replace(/([&%$#_])/g, '\\$1')

export interface BibEntry {
  title: string
  doi: string | null
  meta: PaperMeta | null
}

/** One @article per paper; keys are first author + year + first title word, made unique. */
export function toBibtex(papers: BibEntry[]): string {
  const used = new Set<string>()
  return papers
    .map((paper) => {
      const family = paper.meta?.authors[0]?.split(' ').pop() ?? 'anon'
      const word = paper.title.match(/[A-Za-z]{4,}/)?.[0] ?? 'paper'
      const base = `${family}${paper.meta?.year ?? ''}${word}`.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
      let key = base
      for (let n = 2; used.has(key); n++) key = `${base}${n}`
      used.add(key)

      const fields: [string, string | number | null | undefined][] = [
        ['title', `{${paper.title}}`],
        ['author', paper.meta?.authors.join(' and ')],
        ['journal', paper.meta?.venue],
        ['year', paper.meta?.year],
        ['volume', paper.meta?.volume],
        ['pages', paper.meta?.pages],
        ['doi', paper.doi],
      ]
      const lines = fields
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([name, value]) => `  ${name} = {${name === 'doi' ? value : escapeBibtex(String(value))}}`)
      return `@article{${key},\n${lines.join(',\n')}\n}`
    })
    .join('\n\n')
}
