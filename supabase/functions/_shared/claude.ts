// One structured request to Claude, shared by every function that makes one.
// Kept free of Deno-specific imports so it is type-checked with the app.
import Anthropic from "@anthropic-ai/sdk";
import { RefusedError } from "./refused.ts";

/**
 * Which model does what. Opus reads a whole paper or repository once and
 * everything else is written against that reading, so the cheaper models
 * handle the many smaller requests that follow.
 */
export const MODELS = {
  /** The one reading of a whole paper or repository. */
  read: "claude-opus-5-5",
  /** Page summaries, file notes, quiz questions and answers to the reader. */
  write: "claude-sonnet-5-5",
  /** Marking a short written answer. */
  mark: "claude-haiku-5-5",
} as const;

export interface StructuredRequest {
  model: (typeof MODELS)[keyof typeof MODELS];
  effort: "low" | "medium";
  maxTokens: number;
  system: string | Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  /** JSON schema of the reply. */
  schema: Record<string, unknown>;
}

/** A piece of the prompt that later requests repeat word for word, so it is cached after the first. */
export const cached = (text: string): Anthropic.Beta.BetaTextBlockParam => ({ type: "text", text, cache_control: { type: "ephemeral" } });

export async function structured<T>(apiKey: string, request: StructuredRequest): Promise<T> {
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.create({
    model: request.model,
    max_tokens: request.maxTokens,
    // If a safety filter declines the request, the API retries it on a fallback model. Haiku has no fallback.
    ...(request.model !== MODELS.mark && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    output_config: { effort: request.effort, format: { type: "json_schema", schema: request.schema } },
    system: request.system,
    messages: request.messages,
  });
  if (response.stop_reason === "refusal") throw new RefusedError();
  if (response.stop_reason === "max_tokens") throw new Error("response was cut off");
  return JSON.parse(response.content.find((block) => block.type === "text")?.text ?? "") as T;
}
