// Answers a reader's question with Claude, using the caller's stored Anthropic key.
//   POST { brief, level?, context, quote, history, question, image?, note? } -> { answer, note }
// `quote` is empty for a question about the whole paper. `note` is the summary
// note over the selected passage; the reply's `note` is its new contents if Claude changed it.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { fail, withAnthropicKey } from "../_shared/anthropic.ts";
import { readBrief } from "../_shared/brief.ts";
import { readLevel } from "../_shared/level.ts";
import { answerQuestion, type Note, type Turn } from "./claude.ts";

const MAX_TURNS = 30;

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

function readNote(value: unknown): Note | undefined {
  const note = value as Note | null;
  if (!note || !Array.isArray(note.bullets) || note.bullets.length === 0 || note.bullets.length > 12) return undefined;
  if (!note.bullets.every((bullet) => typeof bullet === "string")) return undefined;
  return {
    bullets: note.bullets.map((bullet) => bullet.slice(0, 600)),
    caveat: typeof note.caveat === "string" ? note.caveat.slice(0, 600) : null,
  };
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return fail(405, "method_not_allowed");

    const body = await req.json().catch(() => null);
    // A paper sends its brief; a codebase sends its map as text.
    const brief = typeof body?.brief === "string" ? body.brief.slice(0, 30_000) : readBrief(body?.brief);
    const history = readHistory(body?.history);
    const question = typeof body?.question === "string" ? body.question.trim().slice(0, 2000) : "";
    const quote = typeof body?.quote === "string" ? body.quote.slice(0, 2000) : "";
    const context = typeof body?.context === "string" ? body.context.slice(0, 200_000) : "";
    // A picture of the selected area: base64 PNG, at most about 3 MB.
    const image = typeof body?.image === "string" && /^[A-Za-z0-9+/]+=*$/.test(body.image) && body.image.length < 4_200_000 ? body.image : undefined;
    if (body?.image !== undefined && !image) return fail(400, "invalid_request");
    if (!brief || !history || !question || !context) return fail(400, "invalid_request");

    return withAnthropicKey(ctx, (key) => answerQuestion(key, { brief, level: readLevel(body.level), context, quote, image, note: readNote(body?.note), history, question }));
  }),
};
