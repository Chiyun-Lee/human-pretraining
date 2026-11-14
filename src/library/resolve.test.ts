import { describe, expect, it } from 'vitest'
import { doiFromUrl, isPdf, metaContent, newestPmcPdf, pmcIdFromUrl, titleFromUrl, toUrl } from '../../supabase/functions/add-paper/resolve.ts'

describe('toUrl', () => {
  it('accepts DOIs, arXiv ids and web addresses', () => {
    expect(toUrl('10.1038/s41586-021-03819-2')?.href).toBe('https://doi.org/10.1038/s41586-021-03819-2')
    expect(toUrl('doi: 10.1101/2020.01.01.123456')?.href).toBe('https://doi.org/10.1101/2020.01.01.123456')
    expect(toUrl('arXiv:1706.03762v5')?.href).toBe('https://arxiv.org/abs/1706.03762v5')
    expect(toUrl(' https://arxiv.org/pdf/1512.03385 ')?.href).toBe('https://arxiv.org/pdf/1512.03385')
    expect(toUrl('www.nature.com/articles/x')?.href).toBe('https://www.nature.com/articles/x')
  })

  it('rejects private addresses and nonsense', () => {
    for (const bad of ['http://localhost:8000/a.pdf', 'http://127.0.0.1/a.pdf', 'http://[::1]/a', 'http://db.internal/x', 'not a url', '']) {
      expect(toUrl(bad), bad).toBeNull()
    }
  })
})

describe('metaContent', () => {
  it('finds the tag whichever way round its attributes are', () => {
    const html = `<head><meta content="https://x.org/a.pdf?b=1&amp;c=2" name="citation_pdf_url">
      <meta name='citation_title' content='Deep &amp; Wide'></head>`
    expect(metaContent(html, 'citation_pdf_url')).toBe('https://x.org/a.pdf?b=1&c=2')
    expect(metaContent(html, 'citation_title')).toBe('Deep & Wide')
    expect(metaContent(html, 'citation_doi')).toBeNull()
  })
})

describe('helpers', () => {
  it('recognises PDF bytes and names a file from its address', () => {
    expect(isPdf(new TextEncoder().encode('%PDF-1.5 ...'))).toBe(true)
    expect(isPdf(new TextEncoder().encode('<html>'))).toBe(false)
    expect(titleFromUrl(new URL('https://arxiv.org/pdf/1512.03385'))).toBe('1512.03385')
    expect(titleFromUrl(new URL('https://x.org/papers/My%20Paper.pdf'))).toBe('My Paper')
  })
})

describe('identifiers in addresses', () => {
  it('reads a PubMed Central id', () => {
    expect(pmcIdFromUrl(new URL('https://pmc.ncbi.nlm.nih.gov/articles/PMC9197487/'))).toBe('PMC9197487')
    expect(pmcIdFromUrl(new URL('https://www.ncbi.nlm.nih.gov/pmc/articles/pmc11588202/pdf/x.pdf'))).toBe('PMC11588202')
    expect(pmcIdFromUrl(new URL('https://example.org/articles/PMC1/'))).toBeNull()
  })

  it('reads a DOI when the address contains or implies one', () => {
    expect(doiFromUrl(new URL('https://doi.org/10.1038/s41586-021-03819-2'))).toBe('10.1038/s41586-021-03819-2')
    expect(doiFromUrl(new URL('https://www.frontiersin.org/articles/10.3389/fgene.2022.868015/full'))).toBe('10.3389/fgene.2022.868015')
    expect(doiFromUrl(new URL('https://academic.oup.com/bioinformatics/article/40/11/btae673/7905460'))).toBe('10.1093/bioinformatics/btae673')
    expect(doiFromUrl(new URL('https://arxiv.org/abs/1706.03762'))).toBeNull()
  })

  it('picks the newest PDF from a bucket listing', () => {
    const xml = '<Key>PMC12.1/PMC12.1.pdf</Key><Key>PMC12.2/PMC12.2.json</Key><Key>PMC12.2/PMC12.2.pdf</Key><Key>PMC123.9/PMC123.9.pdf</Key>'
    expect(newestPmcPdf(xml, 'PMC12')).toBe('PMC12.2/PMC12.2.pdf')
    expect(newestPmcPdf(xml, 'PMC7')).toBeNull()
  })
})
