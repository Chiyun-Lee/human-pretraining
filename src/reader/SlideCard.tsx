// The paper on one slide, above the first page: a branched flow diagram from
// the question, through what was done and each investigation, to what it means.
import { Diagram, type Row } from '../diagram/Diagram'
import type { Slide } from '../summaries/slideShape'

function rows(slide: Slide): Row[] {
  const tested = slide.branches.some((branch) => branch.test)
  return [
    slide.question ? [{ tone: 'question', label: 'The question', text: slide.question }] : [],
    slide.steps.length > 0 ? [{ tone: 'approach', label: 'What they did', steps: slide.steps }] : [],
    tested ? slide.branches.map((branch) => ({ tone: 'test', label: 'They checked', text: branch.test, why: branch.why })) : [],
    slide.branches.map((branch) => ({ tone: 'finding', label: 'Found', text: branch.result })),
    slide.meaning ? [{ tone: 'meaning', label: 'So what?', text: slide.meaning }] : [],
  ]
}

export function SlideCard({ slide }: { slide: Slide }) {
  return (
    <section className="slide" aria-label="The paper on one slide">
      <h2>{slide.title}</h2>
      <p className="takeaway">{slide.takeaway}</p>
      <Diagram rows={rows(slide)} />
      {slide.caveat && <p className="caveat">{slide.caveat}</p>}
      <p className="slide-source">{slide.paper_title}</p>
    </section>
  )
}
