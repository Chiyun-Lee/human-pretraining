// Writes the one-slide summary of a paper with Claude, using the caller's
// stored Anthropic key, together with the brief used for the page summaries.
//   POST { name, text, figures, front } -> { meta, brief, slide }
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { fail, withAnthropicKey } from "../_shared/anthropic.ts";
import { type FigureCaption, makeSlide } from "./claude.ts";

const MAX_CHARS = 200_000;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return fail(405, "method_not_allowed");

    const body = await req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text : "";
    const name = typeof body?.name === "string" ? body.name.slice(0, 300) : "";
    if (text.length < 200 || text.length > MAX_CHARS) return fail(400, "invalid_request");

    const figures: FigureCaption[] = (Array.isArray(body?.figures) ? body.figures : [])
      .filter((f: FigureCaption) => typeof f?.id === "string" && typeof f?.caption === "string")
      .slice(0, 60)
      .map((f: FigureCaption) => ({ id: f.id.slice(0, 40), caption: f.caption.slice(0, 400) }));

    const front = typeof body?.front === "string" ? body.front.slice(0, 4000) : "";

    return withAnthropicKey(ctx, (key) => makeSlide(key, name, text, figures, front));
  }),
};
