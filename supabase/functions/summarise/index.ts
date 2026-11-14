// Summarises a batch of text blocks with Claude, using the caller's stored
// Anthropic key.  POST { brief, blocks, todo? } -> { regions }
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { fail, withAnthropicKey } from "../_shared/anthropic.ts";
import type { Brief } from "../_shared/brief.ts";
import { type InputBlock, summariseBlocks } from "./claude.ts";

const MAX_BLOCKS = 400;
const MAX_CHARS = 60_000;

function readBlocks(value: unknown): InputBlock[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BLOCKS) return null;
  let chars = 0;
  for (const block of value) {
    if (typeof block?.id !== "string" || typeof block?.text !== "string") return null;
    if (block.kind !== "text" && block.kind !== "other") return null;
    if (block.column !== "left" && block.column !== "right" && block.column !== "full") return null;
    chars += block.text.length;
  }
  return chars <= MAX_CHARS ? (value as InputBlock[]) : null;
}

const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");

function readBrief(value: unknown): Brief | null {
  const brief = value as Brief | null;
  if (!brief || !strings(brief.claims) || !strings(brief.evidence) || !strings(brief.weaknesses)) return null;
  if (typeof brief.focus !== "string" || !Array.isArray(brief.terms)) return null;
  if (!brief.terms.every((t) => typeof t?.term === "string" && typeof t?.meaning === "string")) return null;
  return JSON.stringify(brief).length <= 20_000 ? brief : null;
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return fail(405, "method_not_allowed");

    const body = await req.json().catch(() => null);
    const blocks = readBlocks(body?.blocks);
    const brief = readBrief(body?.brief);
    if (!blocks || !brief) return fail(400, "invalid_request");
    const known = new Set(blocks.map((block) => block.id));
    const todo = strings(body?.todo) ? (body.todo as string[]).filter((id) => known.has(id)) : [];

    return withAnthropicKey(ctx, async (key) => ({ regions: await summariseBlocks(key, brief, blocks, todo) }));
  }),
};
