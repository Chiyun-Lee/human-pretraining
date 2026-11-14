// Maps a repository and annotates its files with Claude, using the caller's stored Anthropic key.
//   POST { name, files, docs }       -> { map }
//   POST { background, path, code }  -> { sections }
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { fail, withAnthropicKey } from "../_shared/anthropic.ts";
import { annotateFile, type ListedFile, mapRepository } from "./claude.ts";

const MAX_FILES = 3000;
const MAX_DOC_CHARS = 60_000;
const MAX_CODE_CHARS = 120_000;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return fail(405, "method_not_allowed");
    const body = await req.json().catch(() => null);

    if (typeof body?.code === "string") {
      const { code, path, background } = body;
      if (typeof path !== "string" || typeof background !== "string") return fail(400, "invalid_request");
      if (!code.trim() || code.length > MAX_CODE_CHARS || background.length > 30_000) return fail(400, "invalid_request");
      return withAnthropicKey(ctx, async (key) => ({ sections: await annotateFile(key, background, path.slice(0, 500), code) }));
    }

    const name = typeof body?.name === "string" ? body.name.slice(0, 200) : "";
    const files: ListedFile[] = (Array.isArray(body?.files) ? body.files : [])
      .filter((file: ListedFile) => typeof file?.path === "string" && typeof file?.size === "number")
      .slice(0, MAX_FILES)
      .map((file: ListedFile) => ({ path: file.path.slice(0, 300), size: file.size }));
    let room = MAX_DOC_CHARS;
    const docs = (Array.isArray(body?.docs) ? body.docs : [])
      .filter((doc: { path: string; text: string }) => typeof doc?.path === "string" && typeof doc?.text === "string")
      .slice(0, 12)
      .map((doc: { path: string; text: string }) => {
        const text = doc.text.slice(0, Math.min(20_000, room));
        room -= text.length;
        return { path: doc.path.slice(0, 300), text };
      });
    if (!name || files.length === 0) return fail(400, "invalid_request");
    return withAnthropicKey(ctx, async (key) => ({ map: await mapRepository(key, name, files, docs) }));
  }),
};
