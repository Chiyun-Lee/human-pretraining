// The Claude request that reads a whole paper once, producing the brief that
// page summaries are written against and the one-slide graphical abstract.
// Kept free of Deno-specific imports so it is type-checked with the app.
import Anthropic from "@anthropic-ai/sdk";
import { type Brief, BRIEF_SCHEMA } from "../_shared/brief.ts";
import { RefusedError } from "../_shared/refused.ts";

export interface Slide {
  /** The paper's real title, as printed. */
  paper_title: string;
  /** A short playful title for the slide. */
  title: string;
  takeaway: string;
  flow: { kind: "question" | "approach" | "finding" | "meaning"; text: string }[];
  bullets: string[];
}

const SYSTEM = `You read a whole research paper once and produce two things: a brief that later requests use to summarise the paper page by page, and a graphical abstract slide.

Read as an independent reviewer, not as the authors' publicist. Separate what the paper shows from what it asserts, and judge the claims by the evidence actually presented.

brief:
- claims: the 2 to 5 claims the paper stands or falls on, each one sentence with its headline number.
- evidence: for each claim, what it actually rests on: which data, which comparison or control, at what scale.
- weaknesses: the 1 to 4 gaps that most limit the conclusions, such as a missing baseline, a small or unrepresentative sample, a single dataset, an untested assumption, or a claim worded more strongly than its result. Use only gaps you can point to in the text; do not repeat a limitations section for form's sake, and do not invent problems.
- terms: the 4 to 10 terms, abbreviations and symbols a reader must hold on to, each with one short fixed meaning. Later summaries will use exactly these.
- focus: two or three sentences naming which sections and results carry the argument, and which material is supporting detail a reader can skip (derivations, hyperparameters, implementation specifics, dataset bookkeeping, exhaustive related work, robustness variants).

slide (a warm, slightly playful voice, like a hand-drawn doodle summary, for a researcher from a neighbouring field; keep the real numbers and names):
- paper_title: the paper's actual title, exactly as printed.
- title: a short playful title for the whole paper (at most 8 words).
- takeaway: the one thing to remember, in one sentence (under about 20 words).
- flow: 4 to 6 steps in order that tell the story of the paper: the question, what they did, what they found, and what it means. Give each step its kind (question, approach, finding or meaning) and at most about 10 words of text.
- bullets: 3 to 5 key points worth remembering that the flow does not already say, each under about 15 words. The last one is the brief's most important weakness.

The slide must agree with the brief. Plain text only: no markdown, no citation markers, maths in plain Unicode. State only what the text supports. If the text is not a research paper, describe what it is in the same fields as well as they fit.`;

const text = { type: "string" };
const SLIDE_SCHEMA = {
  type: "object",
  properties: {
    paper_title: text,
    title: text,
    takeaway: text,
    flow: {
      type: "array",
      items: {
        type: "object",
        properties: { kind: { type: "string", enum: ["question", "approach", "finding", "meaning"] }, text },
        required: ["kind", "text"],
        additionalProperties: false,
      },
    },
    bullets: { type: "array", items: text },
  },
  required: ["paper_title", "title", "takeaway", "flow", "bullets"],
  additionalProperties: false,
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: { brief: BRIEF_SCHEMA, slide: SLIDE_SCHEMA },
  required: ["brief", "slide"],
  additionalProperties: false,
};

export async function makeSlide(apiKey: string, name: string, paperText: string): Promise<{ brief: Brief; slide: Slide }> {
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // If a safety filter declines the request, the API retries it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `File name or title: ${name}\n\nPaper text:\n${paperText}` }],
  });

  if (response.stop_reason === "refusal") throw new RefusedError();
  if (response.stop_reason === "max_tokens") throw new Error("slide response was cut off");

  const output = response.content.find((block) => block.type === "text")?.text ?? "";
  const { brief, slide } = JSON.parse(output) as { brief: Brief; slide: Slide };
  return { brief, slide: { ...slide, flow: slide.flow.slice(0, 6), bullets: slide.bullets.slice(0, 5) } };
}
