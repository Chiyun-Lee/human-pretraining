import { describe, expect, it } from 'vitest'
import { readSlide } from './slideShape'

describe('readSlide', () => {
  it('shows a slide saved before slides branched as a plain chain', () => {
    const old = {
      paper_title: 'T',
      title: 't',
      takeaway: 'k',
      flow: [
        { kind: 'question', text: 'Q?' },
        { kind: 'approach', text: 'Did A' },
        { kind: 'finding', text: 'Found F' },
        { kind: 'meaning', text: 'So M' },
      ],
      bullets: ['a point', 'the weakness'],
      figures: [],
    }
    expect(readSlide(old)).toMatchObject({
      question: 'Q?',
      steps: [{ text: 'Did A', why: '' }],
      branches: [{ test: '', why: '', result: 'Found F' }],
      meaning: 'So M',
      caveat: 'the weakness',
    })
  })

  it('rejects anything else', () => {
    expect(readSlide(null)).toBeNull()
    expect(readSlide({ title: 't' })).toBeNull()
  })
})
