/** Who a paper's notes are written for. The reader picks one per paper. */
export type Level = "lay" | "technical" | "expert";

const AUDIENCE: Record<Level, string> = {
  lay: `LAY: someone with no science background. Everyday words only: replace jargon, or explain it in a few words the first time it comes up. Say what was asked, what was found and why it matters; keep a number only when it carries the point, and leave out the fine print of methods. A concrete analogy is welcome where it is accurate. Simpler wording never means a stronger claim: keep the paper's own hedging.`,
  technical: `TECHNICAL: a scientist or engineer from a neighbouring field. They are at home with general science, maths and statistics but not with this field's jargon or methods: define field-specific terms in a few words the first time, say how the methods work and why they were chosen, and keep the key numbers with their uncertainties.`,
  expert: `EXPERT: a researcher in this field. Use its terminology freely and never explain the basics. Be dense: what is new against prior work, the specific methods, data and assumptions, the key quantitative results (effect sizes, error bars, baselines) and the limits on them. No analogies.`,
};

/** The level sent by the app; anything else is read as the default. */
export const readLevel = (value: unknown): Level => (value === "lay" || value === "expert" ? value : "technical");

/** A paragraph for a prompt saying who the reader is. */
export const audience = (level: Level) => `Your reader (pitch everything you write to them):\n${AUDIENCE[level]}`;
