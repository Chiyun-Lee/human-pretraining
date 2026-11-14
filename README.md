# Human Pretraining

A PDF reader for research papers that replaces each paragraph with a short
summary you can flip back to the original. Works in desktop and mobile browsers.

Papers are added by URL, DOI, arXiv id or PDF upload. Claude reads each paper
once, then writes notes over the paragraphs they replace, masks skippable
detail, annotates figure captions and draws a one-slide abstract. The library,
summaries, highlights and notes sync across devices through Supabase. Each user
supplies their own Anthropic API key, which is stored encrypted and used only
on the server.

Live at https://chiyun-lee.github.io/human-pretraining/ (deployed from `main`).

## Run

```sh
npm install
npm run dev        # then open the printed URL and choose a PDF
```

Put PDFs in `public/samples/` (git-ignored) to open them without signing in at
`?file=samples/name.pdf`; add `&demo` for sample notes on `attention.pdf`.

## Develop

```sh
npm test                                         # block detection unit tests
npm run typecheck
node scripts/inspect-blocks.ts paper.pdf [page]  # print detected blocks
node scripts/screenshot.mjs <url> out.png [width] [height] [page]  # needs Chrome and the dev server
node --env-file=.env.local scripts/try-summaries.ts paper.pdf [pages]  # run the real prompts with your own key

npx supabase db push --remote        # apply new migrations
npx supabase functions deploy --remote
```

## Layout

- `src/pdf/`: PDF.js setup, text-block detection and figure finding (pure geometry, unit-tested).
- `src/reader/`: page rendering, the notes drawn over it, the slide, highlights.
- `src/summaries/`: orchestrates Claude's whole-paper read and page summaries; turns its answers into boxes.
- `src/library/`, `src/annotations/`, `src/settings/`, `src/auth/`: the rest of the app.
- `supabase/migrations/`: database schema.
- `supabase/functions/`: server code (`add-paper` fetches PDFs; `slide` and `summarise` call Claude; `anthropic-key` stores the key).
