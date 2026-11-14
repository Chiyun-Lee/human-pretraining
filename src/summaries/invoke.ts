import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

/** A problem the user has to act on; its message is shown as is. */
export class ClaudeError extends Error {}

const MESSAGES: Record<string, string> = {
  no_key: 'Add your Anthropic API key to get summaries.',
  invalid_key: 'Anthropic no longer accepts your API key. Replace it from the library screen.',
  rate_limited: 'Anthropic is rate-limiting your key. Try again in a minute.',
  refused: 'Claude declined this request.',
}

/** Calls one of the server functions that use Claude and returns its JSON reply. */
export async function invokeClaude<T>(name: 'summarise' | 'slide' | 'ask' | 'quiz', body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> })
  if (!error) return data as T

  if (error instanceof FunctionsHttpError) {
    const reply = (await error.context.json().catch(() => null)) as { error?: string; detail?: string } | null
    if (reply?.error === 'anthropic_rejected') throw new ClaudeError(`Anthropic rejected the request: ${reply.detail}`)
    throw new ClaudeError(MESSAGES[reply?.error ?? ''] ?? 'Claude could not be reached. Try again.')
  }
  throw new ClaudeError('Could not reach the server. Check your connection.')
}
