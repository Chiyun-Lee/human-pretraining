// Answers a question about a selected passage with Claude, using the caller's
// stored Anthropic key.  POST { brief, context, quote, history, question } -> { answer }
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { fail, withAnthropicKey } from "../_shared/anthropic.ts";
import { readBrief } from "../_shared/brief.ts";
import { answerQuestion, type Turn } from "./claude.ts";

const MAX_TURNS = 20;

/** Earlier turns must alternate, starting with the reader and ending with Claude. */
function readHistory(value: unknown): Turn[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TURNS || value.length % 2 !== 0) return null;
  const turns: Turn[] = [];
  for (const [i, turn] of value.entries()) {
    if (turn?.role !== (i % 2 === 0 ? "user" : "claude") || typeof turn?.text !== "string" || !turn.text) return null;
    turns.push({ role: turn.role, text: turn.text.slice(0, 6000) });
  }
  return turns;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return fail(405, "method_not_allowed");

    const body = await req.json().catch(() => null);
    const brief = readBrief(body?.brief);
    const history = readHistory(body?.history);
    const question = typeof body?.question === "string" ? body.question.trim().slice(0, 2000) : "";
    const quote = typeof body?.quote === "string" ? body.quote.slice(0, 2000) : "";
    const context = typeof body?.context === "string" ? body.context.slice(0, 20_000) : "";
    if (!brief || !history || !question || !quote) return fail(400, "invalid_request");

    return withAnthropicKey(ctx, async (key) => ({ answer: await answerQuestion(key, brief, context, quote, history, question) }));
  }),
};
