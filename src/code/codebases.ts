// The reader's codebases: a GitHub repository at one commit, Claude's map of
// it, and the notes over each file that has been opened.
import { supabase } from '../lib/supabase'
import { invokeClaude } from '../summaries/invoke'
import { docsToRead, type ListedFile, parseRepo, placeholder, readFile, readRepository } from './github'

export interface CodeMap {
  summary: string
  stack: string[]
  parts: { name: string; role: string; paths: string[] }[]
  flow: string[]
  tour: { path: string; why: string }[]
  folders: { path: string; note: string }[]
  files: { path: string; note: string; weight: 'core' | 'support' | 'skip' }[]
}

export interface Codebase {
  id: string
  owner: string
  repo: string
  /** The commit everything describes. */
  ref: string
  files: ListedFile[]
  map: CodeMap | null
  created_at: string
}

/** A run of lines shown as a note that folds the code away. Lines are counted from 1. */
export interface Section {
  start: number
  end: number
  kind: 'summary' | 'detail'
  title: string
  bullets: string[]
}

const COLUMNS = 'id, owner, repo, ref, files, map, created_at'

export async function listCodebases(): Promise<Codebase[]> {
  const { data, error } = await supabase.from('codebases').select(COLUMNS).order('created_at', { ascending: false })
  if (error) throw error
  return data as Codebase[]
}

/** Adds a public GitHub repository. Nothing is sent to Claude until it is opened. */
export async function addCodebase(address: string): Promise<Codebase> {
  const ref = parseRepo(address)
  if (!ref) throw new Error('That is not a GitHub repository address.')
  const { owner, repo, commit, files } = await readRepository(ref)
  const { data, error } = await supabase.from('codebases').insert({ owner, repo, ref: commit, files }).select(COLUMNS).single()
  if (error) throw new Error('The repository could not be saved. Check your connection.')
  return data as Codebase
}

export async function deleteCodebase(id: string): Promise<void> {
  const { error } = await supabase.from('codebases').delete().eq('id', id)
  if (error) throw error
}

export const fileText = (codebase: Codebase, path: string) => readFile(codebase.owner, codebase.repo, codebase.ref, path)

/** Has Claude map the repository from its file list and documentation, and saves the map. */
export async function mapCodebase(codebase: Codebase): Promise<CodeMap> {
  const docs = await Promise.all(
    docsToRead(codebase.files).map(async (path) => ({ path, text: await fileText(codebase, path).catch(() => '') })),
  )
  const { map } = await invokeClaude<{ map: CodeMap }>('codemap', {
    name: `${codebase.owner}/${codebase.repo}`,
    // Files that cannot be read are still listed, so the map can say what they are.
    files: codebase.files.map((file) => ({ path: file.path, size: file.size })),
    docs: docs.filter((doc) => doc.text),
  })
  const { error } = await supabase.from('codebases').update({ map }).eq('id', codebase.id)
  if (error) console.error(error)
  return map
}

/** The map as the background for requests about one file or question. */
export function mapAsText(codebase: Codebase, map: CodeMap): string {
  return [
    `${codebase.owner}/${codebase.repo}: ${map.summary}`,
    `Parts:\n${map.parts.map((part) => `- ${part.name} (${part.paths.join(', ')}): ${part.role}`).join('\n')}`,
    `Flow:\n${map.flow.map((step, i) => `${i + 1}. ${step}`).join('\n')}`,
    `Files:\n${map.files.filter((file) => file.weight !== 'skip').map((file) => `- ${file.path}: ${file.note}`).join('\n')}`,
  ]
    .join('\n\n')
    .slice(0, 28_000)
}

/** The notes over a file: saved ones if it was opened before, otherwise written by Claude now. */
export async function fileSections(codebase: Codebase, map: CodeMap, path: string, code: string): Promise<Section[]> {
  const saved = await supabase.from('code_notes').select('sections').eq('codebase_id', codebase.id).eq('path', path).maybeSingle()
  if (saved.data) return saved.data.sections as Section[]
  const { sections } = await invokeClaude<{ sections: Section[] }>('codemap', { background: mapAsText(codebase, map), path, code })
  await saveSections(codebase.id, path, sections)
  return sections
}

export async function saveSections(codebaseId: string, path: string, sections: Section[]): Promise<void> {
  const { error } = await supabase.from('code_notes').upsert({ codebase_id: codebaseId, path, sections })
  if (error) console.error(error)
}

export { placeholder }
