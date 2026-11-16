// Summarises a batch of text blocks with Claude, using the caller's stored
// Anthropic key.  POST { brief, level, blocks, todo? } -> { regions }
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { fail, withAnthropicKey } from "../_shared/anthropic.ts";
import { readBrief } from "../_shared/brief.ts";
import { readLevel } from "../_shared/level.ts";
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

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return fail(405, "method_not_allowed");

    const body = await req.json().catch(() => null);
    const blocks = readBlocks(body?.blocks);
    const brief = readBrief(body?.brief);
    if (!blocks || !brief) return fail(400, "invalid_request");
    const known = new Set(blocks.map((block) => block.id));
    const todo = Array.isArray(body?.todo) && body.todo.every((id: unknown) => typeof id === "string") ? (body.todo as string[]).filter((id) => known.has(id)) : [];

    return withAnthropicKey(ctx, async (key) => ({ regions: await summariseBlocks(key, brief, readLevel(body.level), blocks, todo) }));
  }),
};
