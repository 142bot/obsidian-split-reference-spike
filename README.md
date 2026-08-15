# Split Reference — Phase 1 Spike

Feasibility spike for the spec *"Reference text visible while writing on iPhone"*.
Not a product. The goal is to answer the Phase 1 questions in the Path document,
nothing more.

## What it does

- Command **"Ignite reference split (choose file)"** opens a fuzzy picker
  (notes + PDFs), then shows the chosen file **read-only in a CodeMirror 6 top
  panel** above the editor of the current note.
- The reference scrolls independently; a drag handle at the panel's bottom edge
  moves the horizon.
- Split state (`reference`, `reference-height`, `reference-scroll`) is written
  to the **writing note's frontmatter** and restored when the note is reopened.
- Command **"Close reference split"** removes the panel and clears the state.

## Architecture under test

| Piece | Mechanism | Phase 1 question |
|---|---|---|
| Split layout | CM6 `showPanel` top panel (host-provided `@codemirror/panel`, no bundling) | Q1 |
| Reference rendering | `MarkdownRenderer.render` into the panel; PDFs via `![[file.pdf]]` embed | Q2 |
| State | `app.fileManager.processFrontMatter` on the writing note | Q3 |
| Keyboard / scrolling / horizon | panel DOM + pointer events + `view.requestMeasure()` | Q4 |

Plain JS, no build step — the code you read is the code that runs.
Written to also parse on iOS 15-era WebKit.

## Install (BRAT)

1. In Obsidian, open BRAT settings → **Add Beta Plugin**.
2. Enter: `142bot/obsidian-split-reference-spike`
3. Enable **Split Reference (Phase 1 Spike)** in Community Plugins.

BRAT installs from the latest GitHub **release**, which must contain
`main.js`, `manifest.json`, `styles.css` as assets (see VALIDATION.md § Setup).

## Validate

Follow **VALIDATION.md** — it maps each Phase 1 question to test steps,
pass criteria, and fallbacks, and ends with a results table formatted to
paste into the Path document.

## Known spike limitations (deliberate)

- Edit mode only (Live Preview / Source). Reading mode has no CM6 editor.
- One split at a time, globally.
- Uses undocumented `editor.cm` to reach the EditorView.
- Renaming a referenced file is not tracked (rename handler is a Phase 4
  concern; the validation protocol documents current behavior).
- Closing the split clears stored state (spec's "keep state when reference
  missing" is only implemented for the missing-file case).
