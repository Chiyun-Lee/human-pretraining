// Writes the one-slide summary of a paper with Claude, using the caller's
// stored Anthropic key, together with the brief used for the page summaries.
//   POST { name, text } -> { brief, slide }
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { fail, withAnthropicKey } from "../_shared/anthropic.ts";
import { makeSlide } from "./claude.ts";

const MAX_CHARS = 200_000;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return fail(405, "method_not_allowed");

    const body = await req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text : "";
    const name = typeof body?.name === "string" ? body.name.slice(0, 300) : "";
    if (text.length < 200 || text.length > MAX_CHARS) return fail(400, "invalid_request");

    return withAnthropicKey(ctx, (key) => makeSlide(key, name, text));
  }),
};
