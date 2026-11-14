// Saves or removes the signed-in user's Anthropic API key.
//   POST   { key }  checks the key with Anthropic, then stores it encrypted.
//   DELETE          removes the stored key.
// The key is never sent back to the browser.
import "@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "@anthropic-ai/sdk";
import { withSupabase } from "@supabase/server";

const fail = (status: number, error: string) => Response.json({ error }, { status });

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    const userId = ctx.userClaims!.id;

    if (req.method === "DELETE") {
      const { error } = await ctx.supabaseAdmin.rpc("delete_anthropic_key", { p_user_id: userId });
      if (error) {
        console.error(error);
        return fail(500, "storage_failed");
      }
      return Response.json({ ok: true });
    }

    if (req.method !== "POST") return fail(405, "method_not_allowed");

    const body = await req.json().catch(() => null);
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    if (!key.startsWith("sk-ant-") || key.length > 300) return fail(400, "invalid_key");

    try {
      await new Anthropic({ apiKey: key }).models.list({ limit: 1 });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        return fail(400, "invalid_key");
      }
      console.error(error);
      return fail(502, "anthropic_unreachable");
    }

    const { error } = await ctx.supabaseAdmin.rpc("set_anthropic_key", { p_user_id: userId, p_key: key });
    if (error) {
      console.error(error);
      return fail(500, "storage_failed");
    }
    return Response.json({ ok: true });
  }),
};
