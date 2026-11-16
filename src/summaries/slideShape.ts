// The saved shape of a paper's slide, and reading one back from storage.

/** The whole paper on one slide, drawn as a branched flow diagram. */
export interface Slide {
  /** The paper's real title, as printed. */
  paper_title: string
  /** A short playful title for the slide. */
  title: string
  takeaway: string
  question: string
  /** What was done, in order, each with its reason when there is one worth a cell. */
  steps: { text: string; why: string }[]
  /** The separate investigations, each leading to its own result. */
  branches: { test: string; why: string; result: string }[]
  meaning: string
  caveat: string
}

/** A slide saved before slides branched: one chain of steps and a list of points. */
interface ChainSlide {
  paper_title: string
  title: string
  takeaway: string
  flow: { kind: 'question' | 'approach' | 'finding' | 'meaning'; text: string }[]
  bullets: string[]
}

/** A stored slide, or null if it is not one. An older slide is shown as a plain chain until the paper is rewritten. */
export function readSlide(value: unknown): Slide | null {
  if (typeof value !== 'object' || value === null) return null
  if (Array.isArray((value as Slide).steps) && Array.isArray((value as Slide).branches)) return value as Slide
  const old = value as ChainSlide
  if (!Array.isArray(old.flow) || !Array.isArray(old.bullets)) return null
  const texts = (kind: string) => old.flow.filter((step) => step.kind === kind).map((step) => step.text)
  return {
    paper_title: old.paper_title,
    title: old.title,
    takeaway: old.takeaway,
    question: texts('question').join(' '),
    steps: texts('approach').map((text) => ({ text, why: '' })),
    branches: texts('finding').map((result) => ({ test: '', why: '', result })),
    meaning: texts('meaning').join(' '),
    caveat: old.bullets.at(-1) ?? '',
  }
}
