# Phase 1 Validation Protocol

Spike: `obsidian-split-reference-spike` v0.1.0.
Goal: answer the four Phase 1 questions with confidence, or surface the
blocker precisely enough to pick a fallback.

Primary device: iPhone 12 mini (iOS 26). Secondary (optional for closing
Phase 1): iOS 15 device, Catalina Mac (Obsidian 1.7.7), Tahoe Mac (latest).

---

## 0. Setup

1. **Create the release** (one-time, manual — do it on a Mac):
   - Repo → **Releases** → **Draft a new release** → **Choose a tag** →
     create tag `0.1.0` → attach `main.js`, `manifest.json`, `styles.css`
     (download them from the repo first) → **Publish release**.
   - CLI alternative: `gh release create 0.1.0 main.js manifest.json styles.css --title 0.1.0`
   - BRAT installs from release assets; without this step BRAT finds nothing.
2. **Install on the iPhone**: BRAT → Add Beta Plugin →
   `142bot/obsidian-split-reference-spike` → enable the plugin.
3. **Test vault fixtures**:
   - `A.md` — a writing note, long enough to scroll.
   - `Ref-long.md` — a long note with headings, a callout, a wikilink, an image.
   - `Ref.pdf` — a real PDF you actually use (multi-page).
4. Tip: add the two commands to the mobile toolbar (Settings → Mobile)
   so you don't need the command palette each time.

---

## Q1 — Editable A + read-only reference simultaneously on iOS

**Steps**
1. Open `A.md` (editing mode). Run *Ignite reference split* → pick `Ref-long.md`.
2. Type a paragraph in A. Scroll the reference. Scroll A.
3. Switch to another note and back. Toggle reading mode once.

**Pass criteria**
- Panel renders above the editor; A stays fully editable.
- Reference is read-only: no caret, no keyboard triggered from the panel.
- Panel appears only on A, not on other notes.
- Reading mode: no panel (a notice is acceptable); back in edit mode it can be restored.

**Look for**
- Panel duplicating in unexpected editors (desktop split).
- Rendering glitches when Live Preview repaints (folding, tables in A).
- Any console errors (desktop: Cmd-Opt-I; mobile: optional, via BRAT/Safari Web Inspector).

**If it fails**: fall back to the view-container overlay (documented in the
Path log) — but record *what* failed: panel creation, rendering, or gating.

---

## Q2 — PDF in the read-only view

**Steps**
1. Ignite with `Ref.pdf`.
2. Scroll through pages; zoom if the viewer offers it; drag the horizon taller.
3. Leave it open 5 minutes while typing in A (memory check).

**Pass criteria**
- The internal PDF viewer renders inside the panel and is usable at panel height.
- No crash / reload of the app while scrolling the whole PDF.

**Look for**
- Blank panel or endless spinner (embed didn't instantiate in a detached container).
- Jank or app reload on big PDFs (canvas memory).
- Viewer chrome (toolbar) eating too much of the panel height.

**If it fails**: fallback is bundling pdf.js (legacy build for iOS 15) with
on-demand page rendering. Record which symptom appeared.

---

## Q3 — Split state as properties of A

**Steps**
1. After igniting: open A's Properties UI — expect `reference`,
   `reference-height`, `reference-scroll`.
2. Drag the horizon, release → within ~2 s the height property updates.
3. Scroll the reference, switch to another note, come back → same reference,
   height, and scroll position.
4. Force-quit Obsidian, reopen A → state restored.
5. While a debounced write lands (drag/scroll, keep typing): watch the caret.
6. Move/rename `Ref-long.md`, reopen A → expect a quiet notice, A opens
   unsplit, properties still present.

**Pass criteria**
- All three properties round-trip through app restart.
- Writing frontmatter while A is open and being edited does **not** move the
  caret, flicker, or pollute undo.
- Missing reference → notice + state kept (spec's failure mode).

**Look for**
- Frontmatter reformatting (key order, quoting) — cosmetic but note it.
- Sync churn if the vault syncs during the test (file rewrites per gesture).
- Rename specifically: expect the "missing" notice — this documents the known
  gap (a `vault.on('rename')` handler is Phase 4 scope, not a spike failure).

**If it fails**: if writes disturb editing, restrict writes to gesture-end /
file-close / app-pause only. Record the disturbance precisely.

---

## Q4 — Keyboard and independent scrolling on the 12 mini

**Steps**
1. Keyboard open in A → scroll the reference with one finger.
2. Scroll A → reference must not move. Scroll reference → A must not move.
3. Drag the horizon slowly and quickly; release; repeat with keyboard open.
4. With keyboard open: is the caret still visible / does CM scroll it into view?
5. Edge-swipe near the panel (sidebar gestures) → no hijack?

**Pass criteria**
- Keyboard stays open while scrolling the reference.
- No scroll bleed between the two areas.
- Horizon drag never selects text, never scrolls either pane, persists on release.
- Writing area stays usable with keyboard open (judge against the spec's
  friction list).

**Look for**
- Keyboard collapsing when touching the panel (would be the big one).
- The layout not shrinking when the keyboard opens (visualViewport handling
  would become Phase 2 scope).
- Touch targets: is the 16 px handle grabbable with a thumb?

**Pre-accepted fallback** (per plan): auto-collapse the reference to a thin
strip when the keyboard opens. If Q4 fails only on space, accept and log it.

---

## Results — copy into the Path document (Phase 1)

```
1. Can a plugin show an editable view (A) and a read-only reference view at the same time on iOS?
   Answer: YES / NO — <one line: panel mechanism worked / what failed>
2. Can the read-only view render PDFs, not just notes?
   Answer: YES / NO — <embed worked / needs pdf.js; symptoms>
3. Can split state be stored as properties of A?
   Answer: YES / NO — <round-trip + restart + disturbance notes>
4. How do the keyboard and independent scrolling behave on a small phone screen?
   Answer: <behavior summary; fallback accepted?>

Exit outcome: <all yes / fallbacks accepted: …>
```

Log entry suggestion:
`- YYYY-MM-DD — Phase 1 spike validated on iPhone 12 mini (iOS 26) via BRAT. Q1–Q4 answered; see VALIDATION.md results. <blockers/fallbacks>`
