import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { PaperMeta } from './bibliography'

const BUCKET = 'papers'

export interface Paper {
  id: string
  title: string
  file_path: string
  created_at: string
  doi: string | null
  meta: PaperMeta | null
}

const COLUMNS = 'id, title, file_path, created_at, doi, meta'

export async function listPapers(): Promise<Paper[]> {
  const { data, error } = await supabase
    .from('papers')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function addPaper(userId: string, file: File): Promise<Paper> {
  const id = crypto.randomUUID()
  const path = `${userId}/${id}.pdf`
  const upload = await supabase.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf' })
  if (upload.error) throw upload.error

  const { data, error } = await supabase
    .from('papers')
    .insert({ id, title: file.name.replace(/\.pdf$/i, ''), file_path: path })
    .select(COLUMNS)
    .single()
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  return data
}

const ADD_MESSAGES: Record<string, string> = {
  invalid_input: 'That does not look like a web address, DOI or arXiv ID.',
  no_pdf: 'No freely available PDF was found there. Download it yourself and use Add PDF.',
  fetch_failed: 'That site could not be reached or refused the request. Download the PDF and use Add PDF.',
}

/** Adds a paper from a pasted URL, DOI or arXiv id; the server fetches the PDF. */
export async function addPaperFromLink(input: string): Promise<Paper> {
  const { data, error } = await supabase.functions.invoke('add-paper', { body: { input } })
  if (!error) return (data as { paper: Paper }).paper
  if (error instanceof FunctionsHttpError) {
    const code = ((await error.context.json().catch(() => null)) as { error?: string } | null)?.error
    throw new Error(ADD_MESSAGES[code ?? ''] ?? 'The paper could not be added. Try again.')
  }
  throw new Error('Could not reach the server. Check your connection.')
}

export async function downloadPaper(paper: Paper): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(paper.file_path)
  if (error) throw error
  return data.arrayBuffer()
}

export async function deletePaper(paper: Paper): Promise<void> {
  const { error } = await supabase.from('papers').delete().eq('id', paper.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([paper.file_path])
}
