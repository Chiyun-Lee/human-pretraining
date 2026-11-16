// Review cards, using the caller's stored Anthropic key.
//   POST { brief, level, text }                            -> { questions }
//   POST { judge: { prompt, answer, points }, response } -> { verdict, feedback }
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { fail, withAnthropicKey } from "../_shared/anthropic.ts";
import { readBrief } from "../_shared/brief.ts";
import { readLevel } from "../_shared/level.ts";
import { judgeAnswer, writeQuestions } from "./claude.ts";

const MAX_CHARS = 200_000;

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return fail(405, "method_not_allowed");
    const body = await req.json().catch(() => null);

    if (body?.judge) {
      const { prompt, answer, points } = body.judge;
      const response = typeof body.response === "string" ? body.response.trim().slice(0, 4000) : "";
      const valid = typeof prompt === "string" && typeof answer === "string" && Array.isArray(points) &&
        points.length <= 8 && points.every((point: unknown) => typeof point === "string");
      if (!valid || !response) return fail(400, "invalid_request");
      const question = { prompt: prompt.slice(0, 2000), answer: answer.slice(0, 2000), points: points.map((p: string) => p.slice(0, 500)) };
      return withAnthropicKey(ctx, (key) => judgeAnswer(key, question, response));
    }

    const brief = readBrief(body?.brief);
    const text = typeof body?.text === "string" ? body.text : "";
    if (!brief || text.length < 200 || text.length > MAX_CHARS) return fail(400, "invalid_request");
    return withAnthropicKey(ctx, async (key) => ({ questions: await writeQuestions(key, brief, readLevel(body.level), text) }));
  }),
};
