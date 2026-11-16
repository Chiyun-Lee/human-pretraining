// The Claude request that reads a whole paper once, producing the brief that
// page summaries are written against and the one-slide flow diagram.
// Kept free of Deno-specific imports so it is type-checked with the app.
import { type Brief, BRIEF_SCHEMA } from "../_shared/brief.ts";
import { MODELS, structured } from "../_shared/claude.ts";

export interface Slide {
  /** The paper's real title, as printed. */
  paper_title: string;
  /** A short playful title for the slide. */
  title: string;
  takeaway: string;
  question: string;
  /** What was done, in order. "why" is empty when there is no reason worth a cell. */
  steps: { text: string; why: string }[];
  /** The separate investigations, each leading to its own result. */
  branches: { test: string; why: string; result: string }[];
  meaning: string;
  caveat: string;
}

/** Bibliographic details as printed on the paper. */
export interface PrintedMeta {
  doi: string;
  authors: string[];
  year: string;
  venue: string;
}

const SYSTEM = `You read a whole research paper once and produce three things: its bibliographic details, a brief that later requests use to summarise the paper page by page, and a one-slide flow diagram of the paper.

Read as an independent reviewer, not as the authors' publicist. Separate what the paper shows from what it asserts, and judge the claims by the evidence actually presented.

meta (copied from the front matter you are given; use an empty string or list for anything not printed there, and never guess):
- doi: the paper's own DOI, without any "https://doi.org/" prefix.
- authors: every author's full name, in order.
- year: the publication year.
- venue: the journal, conference or preprint server.

brief:
- claims: the 2 to 5 claims the paper stands or falls on, each one sentence with its headline number. Keep the strength of the paper's own wording: a result that "suggests" stays "suggests", and an association is not reported as a cause.
- evidence: for each claim, what it actually rests on: which data, which comparison or control, at what scale.
- weaknesses: the 1 to 4 gaps that most limit the conclusions, such as a missing baseline, a small or unrepresentative sample, a single dataset, an untested assumption, or a claim worded more strongly than its result. Where there is one, include the assumption the main result depends on that the paper does not test, said as "If X does not hold, …". Use only gaps you can point to in the text; do not repeat a limitations section for form's sake, and do not invent problems.
- terms: the 4 to 10 terms, abbreviations and symbols a reader must hold on to, each with one short fixed meaning. Later summaries will use exactly these.
- focus: two or three sentences naming which sections and results carry the argument, and which material is supporting detail a reader can skip (derivations, hyperparameters, implementation specifics, dataset bookkeeping, exhaustive related work, robustness variants).

slide (a warm, slightly playful voice, like a hand-drawn doodle summary, for a researcher from a neighbouring field; keep the real numbers and names):
- paper_title: the paper's actual title, exactly as printed.
- title: a short playful title for the whole paper (at most 8 words).
- takeaway: the one thing to remember, in one sentence (under about 20 words).
The slide is drawn as a branched flow diagram: the question, then one big "what they did" cell holding the steps, then a branch for each investigation leading down to its result, then what it all means, with the caveat underneath. The diagram is the whole summary, so between them the cells must carry everything worth remembering.
- question: the question the paper sets out to answer (at most about 12 words).
- steps: the 2 to 5 rough steps of what was done, in order, as a recipe a newcomer could follow (such as build, train, measure), each at most about 8 words. For up to two steps whose choice a newcomer would not guess, give "why": the paper's reason for doing it that way, in at most about 10 words. Leave "why" empty for the rest.
- branches: the 2 to 4 separate investigations (experiments, analyses, comparisons, ablations) that the brief's claims rest on, most important first. For each: "test", what was examined (at most about 10 words); "why", what this check was meant to settle or rule out (at most about 10 words, or empty if it is obvious); and "result", what came out, with its headline number and the paper's own hedging (at most about 12 words).
- meaning: what the results add up to (at most about 15 words).
- caveat: the brief's most important weakness (at most about 15 words).

The slide must agree with the brief. Plain text only: no markdown, no citation markers, maths in plain Unicode. State only what the text supports. If the text is not a research paper, describe what it is in the same fields as well as they fit.`;

const text = { type: "string" };
const SLIDE_SCHEMA = {
  type: "object",
  properties: {
    paper_title: text,
    title: text,
    takeaway: text,
    question: text,
    steps: {
      type: "array",
      items: { type: "object", properties: { text, why: text }, required: ["text", "why"], additionalProperties: false },
    },
    branches: {
      type: "array",
      items: {
        type: "object",
        properties: { test: text, why: text, result: text },
        required: ["test", "why", "result"],
        additionalProperties: false,
      },
    },
    meaning: text,
    caveat: text,
  },
  required: ["paper_title", "title", "takeaway", "question", "steps", "branches", "meaning", "caveat"],
  additionalProperties: false,
};

const META_SCHEMA = {
  type: "object",
  properties: { doi: text, authors: { type: "array", items: text }, year: text, venue: text },
  required: ["doi", "authors", "year", "venue"],
  additionalProperties: false,
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: { meta: META_SCHEMA, brief: BRIEF_SCHEMA, slide: SLIDE_SCHEMA },
  required: ["meta", "brief", "slide"],
  additionalProperties: false,
};

export async function makeSlide(
  apiKey: string,
  name: string,
  paperText: string,
  front: string,
): Promise<{ meta: PrintedMeta; brief: Brief; slide: Slide }> {
  const { meta, brief, slide } = await structured<{ meta: PrintedMeta; brief: Brief; slide: Slide }>(apiKey, {
    model: MODELS.read,
    effort: "medium",
    maxTokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: `File name or title: ${name}\n\nFront matter (first page as printed):\n${front}\n\nPaper text:\n${paperText}` }],
    schema: OUTPUT_SCHEMA,
  });
  return { meta, brief, slide: { ...slide, steps: slide.steps.slice(0, 5), branches: slide.branches.slice(0, 4) } };
}
