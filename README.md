# Human Pretraining

A PDF reader for research papers that replaces each paragraph with a short
summary you can flip back to the original. Works in desktop and mobile browsers.

Status: reader prototype. Paragraphs are detected in the browser and covered
with placeholder summaries cut from the original text. Accounts, sync, AI
summaries and lessons are not built yet.

## Run

```sh
npm install
npm run dev        # then open the printed URL and choose a PDF
```

Put PDFs in `public/samples/` (git-ignored) to open them with
`?file=samples/name.pdf`.

## Develop

```sh
npm test                                         # block detection unit tests
npm run typecheck
node scripts/inspect-blocks.ts paper.pdf [page]  # print detected blocks
node scripts/screenshot.mjs <url> out.png [width] [height] [page]  # needs Chrome and the dev server
```

## Layout

- `src/pdf/blocks.ts`: groups text fragments into lines and paragraph blocks (pure geometry).
- `src/pdf/pdfjs.ts`: PDF.js setup and text extraction.
- `src/reader/`: page rendering and the summary overlays.
