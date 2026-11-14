// The Claude request behind the reader's questions: about a passage they
// selected, an area of a page, or the paper as a whole. When the question was
// about a passage under a summary note, the answer can also rewrite that note.
// Kept free of Deno-specific imports so it is type-checked with the app.
import Anthropic from "@anthropic-ai/sdk";
import { type Brief, briefAsText } from "../_shared/brief.ts";
import { RefusedError } from "../_shared/refused.ts";

export interface Turn {
  role: "user" | "claude";
  text: string;
}

/** The summary note drawn over the passage being asked about. */
export interface Note {
  bullets: string[];
  caveat: string | null;
}

export interface Question {
  brief: Brief;
  /** Text of the page for a selection; of the whole paper (with page markers) for a general question. */
  context: string;
  /** The selected text; empty for a general question. */
  quote: string;
  /** A PNG of the selected area (base64), when the reader marked out part of the page instead of text. */
  image?: string;
  note?: Note;
  history: Turn[];
  question: string;
}

export interface Reply {
  answer: string;
  /** The note's complete new contents, when Claude changed it. */
  note: Note | null;
}

const SYSTEM = `You help someone read a research paper that has been annotated with short handwritten-style summary notes drawn over the text. They ask you about a passage they selected (from a note or from the paper itself), about an area of a page they marked out (a figure, a table, an equation — shown to you as an image), or about the paper as a whole. You are given a brief of the paper written by an independent reviewer, the relevant text, what they selected if anything, and the note over it if there is one.

reply — answer the question they asked, for a capable reader from outside the field:
- Lead with the answer. Two to five sentences is usually right; use more only if the question needs it.
- Ground the answer in this paper. Use the brief's terms with the brief's meanings. For a question about the whole paper, say which page supports the answer ("p. 4"). When you bring in background knowledge the paper does not state, say so ("the paper doesn't say this, but generally…").
- If the passage claims more than the paper's evidence supports, say so plainly; the brief lists where the evidence falls short.
- For a figure or table, say what is plotted or tabulated (axes, units, groups) before what it shows, and point to the feature that carries the result. For an equation, say what each symbol stands for and what the equation does, in words.
- If neither the paper nor well-established background answers the question, say that you can't tell from the paper rather than guessing.
- Plain text only: no markdown, no headings, no bullet symbols; maths in plain Unicode. It is shown as is in a small chat panel.

The note — when there is a note over the passage, you can change it: reword a bullet, add one, trim one, or change its caveat. The note is the reader's lasting record of this passage, so change it when:
- the reader asks ("reword this", "simplify that bullet", "add that to the note", "note that down", "add my own point: …"): do it straight away, in their words where they gave them; or
- the reader signals they now understand ("thanks", "got it", "that makes sense") and the conversation showed that a bullet was confusingly worded (reword it so it doesn't trip them next time) or that something needed to understand the passage was missing (add it).
Then set update_note to true and give the note's complete new bullets and caveat: keep everything you are not changing exactly as it is, including wording the reader wrote themselves; keep each bullet a complete statement under about 20 words in the same plain voice; at most 5 bullets; caveat is one short sentence or empty. Say in your reply what you changed. Otherwise set update_note to false with empty bullets and caveat. Never change the note for trivia, for what it already says clearly, or when there is no note.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    update_note: { type: "boolean" },
    bullets: { type: "array", items: { type: "string" } },
    caveat: { type: "string" },
  },
  required: ["reply", "update_note", "bullets", "caveat"],
  additionalProperties: false,
};

export async function answerQuestion(apiKey: string, q: Question): Promise<Reply> {
  const about = q.image
    ? "The reader marked out an area of the page, shown in the image."
    : q.quote
      ? `The reader selected:\n"${q.quote}"`
      : "The reader is asking about the paper as a whole; nothing is selected.";
  const note = q.note
    ? `The note over the passage:\n${q.note.bullets.map((b) => `- ${b}`).join("\n")}${q.note.caveat ? `\nCaveat: ${q.note.caveat}` : ""}`
    : "There is no note over this passage.";
  const setting = `Brief of the paper:\n${briefAsText(q.brief)}\n\n${q.quote || q.image ? "Text of the page" : "Text of the paper"}:\n${q.context}\n\n${about}\n\n${note}`;

  const turns = [...q.history, { role: "user" as const, text: q.question }];
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    // If a safety filter declines the request, the API retries it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    // The paper is the same for every follow-up, so it is cached after the first question.
    system: [
      { type: "text", text: SYSTEM },
      { type: "text", text: setting, cache_control: { type: "ephemeral" } },
    ],
    messages: turns.map((turn, i) => {
      const role = turn.role === "user" ? ("user" as const) : ("assistant" as const);
      if (i > 0 || !q.image) return { role, content: turn.text };
      return {
        role,
        content: [
          { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: q.image } },
          { type: "text" as const, text: turn.text },
        ],
      };
    }),
  });

  if (response.stop_reason === "refusal") throw new RefusedError();
  if (response.stop_reason === "max_tokens") throw new Error("answer was cut off");
  const output = response.content.find((block) => block.type === "text")?.text ?? "";
  const parsed = JSON.parse(output) as { reply: string; update_note: boolean; bullets: string[]; caveat: string };
  const bullets = parsed.bullets.map((bullet) => bullet.trim()).filter(Boolean).slice(0, 6);
  if (!parsed.reply.trim()) throw new Error("empty answer");
  return {
    answer: parsed.reply.trim(),
    note: q.note && parsed.update_note && bullets.length > 0 ? { bullets, caveat: parsed.caveat.trim() || null } : null,
  };
}
