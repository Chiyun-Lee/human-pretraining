// Shared by the functions that call Claude with the caller's stored key.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseContext } from "@supabase/server";
import { RefusedError } from "./refused.ts";

export const fail = (status: number, error: string) => Response.json({ error }, { status });

/** Looks up the caller's key, runs the task with it, and maps failures to error codes. */
export async function withAnthropicKey(ctx: SupabaseContext, task: (apiKey: string) => Promise<unknown>): Promise<Response> {
  const { data: key, error } = await ctx.supabaseAdmin.rpc("get_anthropic_key", { p_user_id: ctx.userClaims!.id });
  if (error) {
    console.error(error);
    return fail(500, "storage_failed");
  }
  if (!key) return fail(400, "no_key");

  try {
    return Response.json(await task(key));
  } catch (error) {
    if (error instanceof RefusedError) return fail(422, "refused");
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return fail(400, "invalid_key");
    }
    if (error instanceof Anthropic.RateLimitError) return fail(429, "rate_limited");
    if (error instanceof Anthropic.BadRequestError) {
      // Includes "credit balance is too low"; the message is safe to show.
      console.error(error.message);
      return Response.json({ error: "anthropic_rejected", detail: error.message }, { status: 400 });
    }
    console.error(error);
    return fail(502, "anthropic_failed");
  }
}
