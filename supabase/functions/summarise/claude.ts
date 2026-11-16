// The Claude request that turns a paper's text blocks into grouped summaries.
// Kept free of Deno-specific imports so it is type-checked with the app.
import { type Brief, briefAsText } from "../_shared/brief.ts";
import { cached, MODELS, structured } from "../_shared/claude.ts";
import { audience, type Level } from "../_shared/level.ts";

export interface InputBlock {
  id: string;
  /** "text" is a body paragraph; "other" is a heading, equation, caption and so on. */
  kind: "text" | "other";
  column: "left" | "right" | "full";
  text: string;
}

export interface SummaryGroup {
  blocks: string[];
  /** "summary" replaces text with bullets; "figure" is a note over a caption; "detail" masks text behind a label. */
  kind: "summary" | "figure" | "detail";
  bullets: string[];
  /** One per bullet: the sentence it was drawn from and what that sentence does in the paper. */
  sources: Source[];
  /** Where the evidence falls short of what this passage claims, or "". */
  caveat: string;
}

export interface Source {
  quote: string;
  facet: "goal" | "method" | "result" | "other";
}

const SYSTEM = `You annotate a research paper for a reader who wants its substance in five minutes; who that reader is, and so how to word things for them, is described with the brief. Your notes are drawn over the PDF in place of the original text, in a larger font inside the rectangle that text occupied; the reader can flip any note back to the original.

You are given a brief of the whole paper, written by an independent reviewer, and then the text blocks of a few pages in reading order, one per line, as four fields separated by tabs: id, kind ("text" is body prose, from a full paragraph down to a single line; "other" is a heading, equation, caption, list fragment, table cell or page furniture), column (left, right or full), and the text.

Return regions. A region is a run of neighbouring blocks from the same page and the same column, named by its first and last block ids in reading order (the same id twice for a single block); it covers those two blocks and every block between them. A region is of one of three kinds.

kind "summary": text that carries the paper's argument, replaced by bullets.
- Use it only for what a reader needs in order to understand and judge the claims in the brief: the question and why it matters, the core idea of the method, the experiments that bear on the claims, the main results, and the limits on them.
- One to four bullets. Each is a complete statement that keeps the key numbers and names. Total length about a third of the source and never more than half.
- Report what is shown, not just what is said. When a passage asserts more than the evidence in the paper supports, word the bullet as what was actually measured or done, and put the gap in caveat: one short sentence such as "Compared against a single baseline" or "Shown on one dataset of 40 patients". Leave caveat empty unless the brief or the passage itself gives you the grounds; never invent a criticism.
- Every bullet names its source, so the reader can check it against the paper. quote: the one sentence of the original (or its main clause, at most about 30 words) that the bullet most directly rests on, copied character for character from the block text with nothing added, dropped or corrected. facet: what that sentence does in the paper — "goal" (the question, gap or aim), "method" (what was done or how it works), "result" (what was found or measured), or "other".
- Keep the strength of the original wording: "suggests", "may" and "is associated with" are never upgraded to "shows" or "causes".
- Write in a neutral voice. Do not adopt the authors' adjectives (novel, significant, state of the art) unless you give the number that earns them.

kind "figure": a note about a figure or table, drawn over its caption while the figure itself stays in view above it.
- Every figure and table caption gets a region of its own, covering the whole caption and nothing else. Use kind "figure" when the figure bears on the claims in the brief, and kind "detail" (label such as "Figure 3: ablation variants") when it is peripheral.
- One or two bullets, each with quote "" and facet "other": what the figure shows and what to notice in it, with the key number or comparison. Start with the figure's number, such as "Fig. 2:". The caveat rule above applies.

kind "detail": text the reader can skip without losing the argument, masked behind a label.
- Use it freely. Derivation steps, hyperparameters and implementation specifics, dataset bookkeeping, exhaustive related work, robustness variants, extended discussion of side results, author lists and affiliations, acknowledgements, funding, footnotes and dense tables are all detail. In most papers more than half of the text is detail; do not summarise something merely because it is there.
- bullets holds exactly one label (quote "", facet "other") of at most six words naming what is underneath, such as "Training hyperparameters", "Proof of Lemma 2" or "Acknowledgements". caveat is empty.

Grouping, for both kinds:
- Put neighbouring blocks that belong together into one region: a paragraph split by a displayed equation, a list with its lead-in sentence, several paragraphs on one point, a whole run of detail.
- A region covers everything between its first and last block, including "other" blocks such as equations, so end it before anything it should not hide.
- Never include a section heading in a region, never mix a caption with body text, and never let a region span a heading or a caption. Start a new region after it.
- A paragraph that runs on into the next column of the same page is one region: first is its block at the foot of one column and last is its block at the head of the next. This is the only case where a region may cross columns.
- The first text block on a page is often the tail of a paragraph from the previous page. Fold it into the following region when it belongs with it; otherwise make it a "detail" region labelled "Continued from previous page".
- Never leave a text block uncovered next to a region.
- Give every body-prose text block exactly one region, of whichever kind fits.

Consistency: use the terms from the brief with the meanings given there, state every number the way the paper does, and write nothing that contradicts the brief. If a passage contradicts the brief, report the passage accurately and say so in caveat.

Plain text only: no markdown, no citation markers, maths in plain Unicode. Do not open with "The authors" or "This paragraph". Use only block ids that appear in the input.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    regions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          first: { type: "string" },
          last: { type: "string" },
          kind: { type: "string", enum: ["summary", "figure", "detail"] },
          bullets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                quote: { type: "string" },
                facet: { type: "string", enum: ["goal", "method", "result", "other"] },
              },
              required: ["text", "quote", "facet"],
              additionalProperties: false,
            },
          },
          caveat: { type: "string" },
        },
        required: ["first", "last", "kind", "bullets", "caveat"],
        additionalProperties: false,
      },
    },
  },
  required: ["regions"],
  additionalProperties: false,
};

const oneLine = (text: string) => text.replace(/\s+/g, " ");

export async function summariseBlocks(apiKey: string, brief: Brief, level: Level, blocks: InputBlock[], todo: string[] = []): Promise<SummaryGroup[]> {
  type Written = Omit<SummaryGroup, "blocks" | "bullets" | "sources"> & { first: string; last: string; bullets: (Source & { text: string })[] };
  const { regions } = await structured<{ regions: Written[] }>(apiKey, {
    model: MODELS.write,
    effort: "low",
    maxTokens: 16000,
    // The brief and the reader are the same for every batch of the paper, so they are cached after the first.
    system: [{ type: "text", text: SYSTEM }, cached(`Brief of the whole paper:\n\n${briefAsText(brief)}\n\n${audience(level)}`)],
    messages: [
      {
        role: "user",
        content:
          `Blocks:\n${blocks.map((b) => `${b.id}\t${b.kind}\t${b.column}\t${oneLine(b.text)}`).join("\n")}` +
          (todo.length > 0
            ? `\n\nThe other text blocks already have regions. Return regions only for these text blocks, which were missed: ${todo.join(", ")}. A region may also cover the "other" blocks that lie between them, but no other text block.`
            : ""),
      },
    ],
    schema: OUTPUT_SCHEMA,
  });

  const position = new Map(blocks.map((block, i) => [block.id, i]));
  return regions.flatMap(({ first, last, bullets, ...region }) => {
    const from = position.get(first);
    const to = position.get(last);
    // A region that names a block that was not sent, or runs backwards, cannot be drawn.
    if (from === undefined || to === undefined || to < from) return [];
    const kept = bullets.filter((bullet) => bullet.text.trim());
    return [{
      ...region,
      blocks: blocks.slice(from, to + 1).map((block) => block.id),
      bullets: kept.map((bullet) => bullet.text.trim()),
      sources: kept.map(({ quote, facet }) => ({ quote: quote.trim(), facet })),
    }];
  });
}
