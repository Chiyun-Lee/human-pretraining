import { describe, expect, it } from 'vitest'
import { byline, parseCrossref, referenceLine, toBibtex } from './bibliography'

const message = {
  title: ['Pf-HaploAtlas: an interactive web app for\n   <i>Plasmodium falciparum</i> genes'],
  'container-title': ['Bioinformatics'],
  issued: { 'date-parts': [[2024, 11, 1]] },
  volume: '40',
  author: [
    { given: 'Chiyun', family: 'Lee' },
    { given: 'Eyyüb S', family: 'Ünlü' },
    { given: 'Nina F D', family: 'White' },
    { given: 'Jacob', family: 'Almagro-Garcia' },
  ],
  reference: [
    { DOI: '10.1093/nar/gkad1003', 'article-title': 'VEuPathDB in 2023', author: 'Alvarez-Jarreta', year: '2024', 'journal-title': 'Nucleic Acids Res' },
    { unstructured: 'WHO. World malaria report 2023.' },
  ],
}

describe('parseCrossref', () => {
  const record = parseCrossref(message)

  it('reads the paper’s own details', () => {
    expect(record.title).toBe('Pf-HaploAtlas: an interactive web app for Plasmodium falciparum genes')
    expect(record.meta).toMatchObject({ year: 2024, venue: 'Bioinformatics', volume: '40' })
    expect(record.meta.authors[1]).toBe('Eyyüb S Ünlü')
    expect(byline(record.meta)).toBe('Lee, Ünlü, White et al. · Bioinformatics 2024')
  })

  it('reads structured and unstructured references', () => {
    expect(record.refs.map(referenceLine)).toEqual([
      'Alvarez-Jarreta et al. (2024) VEuPathDB in 2023 Nucleic Acids Res',
      'WHO. World malaria report 2023.',
    ])
    expect(record.refs[0]!.doi).toBe('10.1093/nar/gkad1003')
  })
})

describe('toBibtex', () => {
  it('writes entries with unique keys and escaped text', () => {
    const record = parseCrossref(message)
    const entry = { title: 'Cost & benefit of 100% coverage', doi: '10.1/x_y', meta: record.meta }
    const bib = toBibtex([entry, entry, { title: 'Untitled', doi: null, meta: null }])
    expect(bib).toContain('@article{lee2024cost,')
    expect(bib).toContain('@article{lee2024cost2,')
    expect(bib).toContain('title = {{Cost \\& benefit of 100\\% coverage}}')
    expect(bib).toContain('author = {Chiyun Lee and Eyyüb S Ünlü and Nina F D White and Jacob Almagro-Garcia}')
    expect(bib).toContain('doi = {10.1/x_y}')
    expect(bib).toContain('@article{anonuntitled,\n  title = {{Untitled}}\n}')
  })
})
