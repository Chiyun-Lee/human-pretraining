// The Claude request that answers a reader's question about a passage they
// selected. Kept free of Deno-specific imports so it is type-checked with the app.
import Anthropic from "@anthropic-ai/sdk";
import { type Brief, briefAsText } from "../_shared/brief.ts";
import { RefusedError } from "../_shared/refused.ts";

export interface Turn {
  role: "user" | "claude";
  text: string;
}

const SYSTEM = `A reader is working through a research paper and has selected a passage to ask about. You are given a brief of the whole paper, the text of the page the passage is on, the passage, and their question.

Answer the question they asked, for a capable reader from outside the field:
- Lead with the answer. Two to five sentences is usually right; use more only if the question needs it.
- Ground the answer in this paper. Use the brief's terms with the brief's meanings. When you bring in background knowledge the paper does not state, say so ("the paper doesn't say this, but generally…").
- If the passage claims more than the paper's evidence supports, say so plainly; the brief lists where the evidence falls short.
- If neither the paper nor well-established background answers the question, say that you can't tell from the paper rather than guessing.
- Plain text only: no markdown, no headings, no bullet symbols; maths in plain Unicode.`;

export async function answerQuestion(
  apiKey: string,
  brief: Brief,
  context: string,
  quote: string,
  history: Turn[],
  question: string,
): Promise<string> {
  const setting = `Brief of the paper:\n${briefAsText(brief)}\n\nText of the page:\n${context}\n\nSelected passage:\n"${quote}"`;
  const turns = [...history, { role: "user" as const, text: question }];
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    // If a safety filter declines the request, the API retries it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: turns.map((turn, i) => ({
      role: turn.role === "user" ? ("user" as const) : ("assistant" as const),
      // The paper travels with the first question; follow-ups are just the question.
      content: i === 0 ? `${setting}\n\nQuestion: ${turn.text}` : turn.text,
    })),
  });

  if (response.stop_reason === "refusal") throw new RefusedError();
  const answer = response.content.find((block) => block.type === "text")?.text.trim() ?? "";
  if (!answer) throw new Error("empty answer");
  return answer;
}
