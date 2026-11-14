import { describe, expect, it } from 'vitest'
import { tidySections } from '../../supabase/functions/codemap/claude.ts'
import { buildTree, docsToRead, isListed, parseRepo, placeholder } from './github'

const file = (path: string, size = 1000) => ({ path, size })

describe('parseRepo', () => {
  it('reads repository addresses', () => {
    expect(parseRepo('https://github.com/Chiyun-Lee/human-pretraining')).toEqual({ owner: 'Chiyun-Lee', repo: 'human-pretraining' })
    expect(parseRepo('github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b' })
    expect(parseRepo('https://github.com/a/b/tree/feature/x?tab=readme')).toEqual({ owner: 'a', repo: 'b', branch: 'feature/x' })
  })
  it('leaves papers alone', () => {
    expect(parseRepo('10.1038/nature14539')).toBeNull()
    expect(parseRepo('https://arxiv.org/abs/1706.03762')).toBeNull()
    expect(parseRepo('https://github.com/a/b/blob/main/paper.pdf')).toBeNull()
  })
})

describe('files', () => {
  it('drops dependency and build folders', () => {
    expect(isListed('src/app.ts')).toBe(true)
    expect(isListed('node_modules/react/index.js')).toBe(false)
    expect(isListed('web/dist/app.js')).toBe(false)
  })

  it('replaces unreadable files with a reason', () => {
    expect(placeholder(file('src/app.ts'))).toBeNull()
    expect(placeholder(file('package-lock.json', 400_000))).toMatch(/Lock file/)
    expect(placeholder(file('logo.png', 20_000))).toBe('Binary file · 20 KB')
    expect(placeholder(file('data/cities.json', 2_400_000))).toBe('Large file · 2.4 MB')
  })

  it('picks the documents that describe the project', () => {
    const docs = docsToRead([file('src/a.ts'), file('package.json'), file('README.md'), file('docs/deep/README.md'), file('backend/pyproject.toml')])
    expect(docs).toEqual(['README.md', 'package.json', 'backend/pyproject.toml'])
  })

  it('nests files, folders first, joining single-folder chains', () => {
    const tree = buildTree([file('README.md'), file('src/main/java/App.java'), file('src/main/java/Util.java'), file('docs/a.md')])
    expect(tree.map((n) => n.name)).toEqual(['docs', 'src/main/java', 'README.md'])
    expect(tree[1]!.children.map((n) => n.name)).toEqual(['App.java', 'Util.java'])
    expect(tree[1]!.path).toBe('src/main/java')
  })
})

describe('tidySections', () => {
  it('orders sections and drops overlaps, empties and lines past the end', () => {
    const tidy = tidySections(
      [
        { start: 10, end: 30, kind: 'summary', title: 'run', bullets: ['Does it.'] },
        { start: 1, end: 4, kind: 'detail', title: 'Imports', bullets: ['ignored'] },
        { start: 25, end: 40, kind: 'summary', title: 'overlaps', bullets: ['x'] },
        { start: 31, end: 99, kind: 'summary', title: 'tail', bullets: ['y'] },
        { start: 5, end: 9, kind: 'summary', title: 'nothing said', bullets: [] },
      ],
      50,
    )
    expect(tidy.map((s) => [s.start, s.end, s.title])).toEqual([[1, 4, 'Imports'], [10, 30, 'run'], [31, 50, 'tail']])
    expect(tidy[0]!.bullets).toEqual([])
  })
})
