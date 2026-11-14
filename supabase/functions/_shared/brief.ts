/**
 * An independent reading of the whole paper, written once and given to every
 * later request so that all summaries share one view of it.
 */
export interface Brief {
  /** The few claims the paper stands or falls on. */
  claims: string[];
  /** What each claim actually rests on: data, comparison, scale. */
  evidence: string[];
  /** Where the evidence falls short of the claims. */
  weaknesses: string[];
  /** Terms and symbols the paper uses, with one fixed meaning each. */
  terms: { term: string; meaning: string }[];
  /** Which parts carry the argument and which are supporting detail. */
  focus: string;
}

export const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    claims: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    terms: {
      type: "array",
      items: {
        type: "object",
        properties: { term: { type: "string" }, meaning: { type: "string" } },
        required: ["term", "meaning"],
        additionalProperties: false,
      },
    },
    focus: { type: "string" },
  },
  required: ["claims", "evidence", "weaknesses", "terms", "focus"],
  additionalProperties: false,
};

export function briefAsText(brief: Brief): string {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  return [
    `Central claims:\n${list(brief.claims)}`,
    `What they rest on:\n${list(brief.evidence)}`,
    `Where the evidence falls short:\n${list(brief.weaknesses)}`,
    `Terms (use these, with these meanings):\n${list(brief.terms.map((t) => `${t.term}: ${t.meaning}`))}`,
    `What matters and what is detail:\n${brief.focus}`,
  ].join("\n\n");
}

const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");

/** A brief sent back by the app, checked before it goes into a prompt. */
export function readBrief(value: unknown): Brief | null {
  const brief = value as Brief | null;
  if (!brief || !strings(brief.claims) || !strings(brief.evidence) || !strings(brief.weaknesses)) return null;
  if (typeof brief.focus !== "string" || !Array.isArray(brief.terms)) return null;
  if (!brief.terms.every((t) => typeof t?.term === "string" && typeof t?.meaning === "string")) return null;
  return JSON.stringify(brief).length <= 20_000 ? brief : null;
}
