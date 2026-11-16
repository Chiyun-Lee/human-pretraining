// The Claude requests behind the codebase viewer: mapping a repository from
// its file list and documentation, and writing the notes over one file.
// Kept free of Deno-specific imports so it is type-checked with the app.
import Anthropic from "@anthropic-ai/sdk";
import { RefusedError } from "../_shared/refused.ts";

/** An overview of a repository, written once and given to every later request about it. */
export interface CodeMap {
  /** What the project is and who uses it, in two or three sentences. */
  summary: string;
  /** Languages, frameworks and services it is built on. */
  stack: string[];
  /** The handful of parts the code divides into. */
  parts: { name: string; role: string; paths: string[] }[];
  /** How one typical request or run moves through those parts, in order. */
  flow: Stage[];
  /** The files to read first, in order, to understand the project. */
  tour: { path: string; why: string }[];
  /** One line on each folder that matters. */
  folders: { path: string; note: string }[];
  /** One line on each file that matters; "skip" marks files a reader can ignore. */
  files: { path: string; note: string; weight: "core" | "support" | "skip" }[];
}

/** One stage of the flow. Several paths mean the run splits here. */
export interface Stage {
  paths: { part: string; when: string; steps: string[] }[];
}

export interface ListedFile {
  path: string;
  size: number;
}

const MAP_SYSTEM = `You map a code repository for someone who has never seen it and wants to understand how it works without reading most of it. You are given its file list (path and size in bytes) and the contents of its documentation and manifest files. Your map is shown as an overview page and as one-line notes beside the folders and files of a file tree.

Judge the project from what is in front of you. Prefer what the code layout and manifests show over what the README claims; if you cannot tell what something does from its name and place, say what it appears to be rather than inventing a role.

- summary: what the project does and for whom, in two or three plain sentences. No marketing words.
- stack: the 3 to 8 languages, frameworks and external services it rests on.
- parts: the 3 to 7 parts the code divides into (for example "web client", "API", "background jobs", "database schema"). For each: a short name, its role in one sentence, and the folders or files that make it up. Every important folder belongs to exactly one part.
- flow: one typical request, command or run traced through the parts, as 3 to 6 stages in order. It is drawn as a flow diagram with one cell per path, and it is the single most useful thing for a newcomer, so make it concrete. A stage normally has one path. Where the run really splits (a cached result against a fresh one, one command against another, success against failure, work done side by side) give that stage 2 or 3 paths. For each path: "part", the name of the part doing the work, exactly as in parts; "when", the condition for taking this path in at most 6 words, or empty if the stage has one path; "steps", 1 to 4 things that happen there in order, each under 12 words and naming the file or function, such as "Reader asks the summarise function for a batch of pages".
- tour: the 5 to 9 files to read first, in the order to read them, each with one sentence on what to look for in it. Start at the entry point and follow the flow; include the file that holds the central data model. Only paths from the file list.
- folders: one line (under 15 words) for each folder a newcomer would open, saying what lives there. Skip folders whose name says it all.
- files: one line (under 15 words) for each file that matters, saying its role in the project rather than its contents (not "Contains utility functions" but "Date and string helpers used by the API routes"), up to about 120, with a weight. "core": the project's own logic that carries the flow. "support": configuration, tests, types, styling, small helpers. "skip": generated, vendored, lock, fixture and boilerplate files that a reader can ignore. Give every file in the tour a "core" note. Only paths from the file list.

Plain text only: no markdown. Write for a capable programmer from another stack.`;

const text = { type: "string" };
const strings = { type: "array", items: text };
const MAP_SCHEMA = {
  type: "object",
  properties: {
    summary: text,
    stack: strings,
    parts: {
      type: "array",
      items: {
        type: "object",
        properties: { name: text, role: text, paths: strings },
        required: ["name", "role", "paths"],
        additionalProperties: false,
      },
    },
    flow: {
      type: "array",
      items: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: {
              type: "object",
              properties: { part: text, when: text, steps: strings },
              required: ["part", "when", "steps"],
              additionalProperties: false,
            },
          },
        },
        required: ["paths"],
        additionalProperties: false,
      },
    },
    tour: {
      type: "array",
      items: { type: "object", properties: { path: text, why: text }, required: ["path", "why"], additionalProperties: false },
    },
    folders: {
      type: "array",
      items: { type: "object", properties: { path: text, note: text }, required: ["path", "note"], additionalProperties: false },
    },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { path: text, note: text, weight: { type: "string", enum: ["core", "support", "skip"] } },
        required: ["path", "note", "weight"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "stack", "parts", "flow", "tour", "folders", "files"],
  additionalProperties: false,
};

async function structured<T>(apiKey: string, effort: "low" | "medium", system: string, schema: unknown, user: string): Promise<T> {
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // If a safety filter declines the request, the API retries it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema: schema as Record<string, unknown> } },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw new RefusedError();
  if (response.stop_reason === "max_tokens") throw new Error("response was cut off");
  return JSON.parse(response.content.find((block) => block.type === "text")?.text ?? "") as T;
}

export async function mapRepository(apiKey: string, name: string, files: ListedFile[], docs: { path: string; text: string }[]): Promise<CodeMap> {
  const listing = files.map((file) => `${file.path}\t${file.size}`).join("\n");
  const documents = docs.map((doc) => `=== ${doc.path}\n${doc.text}`).join("\n\n");
  const map = await structured<CodeMap>(
    apiKey,
    "medium",
    MAP_SYSTEM,
    MAP_SCHEMA,
    `Repository: ${name}\n\nFiles (path, bytes):\n${listing}\n\nDocumentation and manifests:\n${documents || "(none)"}`,
  );
  // Notes on paths that do not exist would point nowhere.
  const known = new Set(files.map((file) => file.path));
  const isFolder = (path: string) => files.some((file) => file.path.startsWith(path.replace(/\/$/, "") + "/"));
  return {
    ...map,
    flow: map.flow.map((stage) => ({ paths: stage.paths.filter((path) => path.steps.length > 0).slice(0, 3) })).filter((stage) => stage.paths.length > 0),
    tour: map.tour.filter((stop) => known.has(stop.path)),
    files: map.files.filter((file) => known.has(file.path)),
    folders: map.folders.map((folder) => ({ ...folder, path: folder.path.replace(/\/$/, "") })).filter((folder) => isFolder(folder.path)),
  };
}

/** A run of lines in a file, shown as a note that folds the code away. */
export interface Section {
  /** First and last line, counted from 1. */
  start: number;
  end: number;
  /** "summary" explains code that matters; "detail" folds away code a reader can skip. */
  kind: "summary" | "detail";
  /** What this is: a function or class name, or a few words. */
  title: string;
  bullets: string[];
}

const FILE_SYSTEM = `You annotate one source file for someone learning how a codebase works. You are given a map of the whole repository and the file with numbered lines. Your notes are shown in place of the code, each with a switch to reveal the lines underneath, so a reader can understand the file from the notes alone and open only what they care about.

Divide the file into sections: consecutive runs of lines that belong together, such as the imports, one function or class, a group of small related helpers, a block of configuration, one test group. Sections are in order, do not overlap, and together cover every non-blank line. Follow the code's own boundaries: never cut a function in two. A long class may be one section per method group. Aim for 3 to 15 sections; a short file may be a single section.

kind "summary": code that carries what the file is for.
- title: the name as written in the code (a function, class, component, route or constant), or a few words if it has none.
- bullets: one to four, each a complete plain statement of what the code does and why it is there: its inputs and result, the decision it makes, what calls it or what it calls elsewhere in the repository (name the file, using the map), and anything surprising — a side effect, an assumption, an edge case handled or missed. Keep real names and numbers. Do not narrate line by line, and do not restate the signature.

kind "detail": code a reader can skip without losing the thread — imports, type declarations that say nothing new, boilerplate, logging, licence headers, long literal data, straightforward getters. Use it freely. title is a label of at most six words such as "Imports" or "Prop types"; bullets is empty.

State only what the code shows. If something depends on code you cannot see, say what it appears to do. Plain text only: no markdown, no code fences. Use line numbers from the input.`;

const SECTIONS_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "integer" },
          end: { type: "integer" },
          kind: { type: "string", enum: ["summary", "detail"] },
          title: text,
          bullets: strings,
        },
        required: ["start", "end", "kind", "title", "bullets"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections"],
  additionalProperties: false,
};

/** Puts sections in order and drops any that overlap an earlier one or fall outside the file. */
export function tidySections(sections: Section[], lineCount: number): Section[] {
  const kept: Section[] = [];
  let covered = 0;
  for (const section of [...sections].sort((a, b) => a.start - b.start)) {
    const start = Math.max(section.start, 1);
    const end = Math.min(section.end, lineCount);
    const bullets = section.bullets.map((bullet) => bullet.trim()).filter(Boolean);
    if (start <= covered || end < start || !section.title.trim()) continue;
    if (section.kind === "summary" && bullets.length === 0) continue;
    kept.push({ start, end, kind: section.kind, title: section.title.trim(), bullets: section.kind === "detail" ? [] : bullets });
    covered = end;
  }
  return kept;
}

export async function annotateFile(apiKey: string, background: string, path: string, code: string): Promise<Section[]> {
  const lines = code.split("\n");
  const numbered = lines.map((line, i) => `${i + 1}\t${line}`).join("\n");
  const { sections } = await structured<{ sections: Section[] }>(
    apiKey,
    "low",
    FILE_SYSTEM,
    SECTIONS_SCHEMA,
    `Map of the repository:\n${background}\n\nFile: ${path}\n\n${numbered}`,
  );
  return tidySections(sections, lines.length);
}
