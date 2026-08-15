"use strict";

/*
 * Split Reference - Phase 1 feasibility spike.
 *
 * Architecture under test:
 *   - Reference view = a CodeMirror 6 TOP PANEL (host-provided
 *     @codemirror/panel, zero bundle cost, version-matched to the editor).
 *   - Content rendered with MarkdownRenderer (notes AND `![[pdf]]` embeds).
 *   - Split state stored in the writing note's frontmatter via
 *     app.fileManager.processFrontMatter.
 *
 * Plain JS on purpose: no build step, the code you read is the code that runs.
 * Written to run on iOS 15-era WebKit too (no lookbehind, no Array.at, etc.).
 */

const obsidian = require("obsidian");
const {
  Plugin,
  MarkdownView,
  MarkdownRenderer,
  FuzzySuggestModal,
  Notice,
  Component,
  TFile,
} = obsidian;
const { StateField, StateEffect } = require("@codemirror/state");
const { showPanel } = require("@codemirror/panel");

const FM_REFERENCE = "reference";
const FM_HEIGHT = "reference-height";
const FM_SCROLL = "reference-scroll";

const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 80;
const PERSIST_DEBOUNCE_MS = 1500;

// null = no panel; otherwise { refPath, height, scrollTop }
const setSplitEffect = StateEffect.define();

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

function toNumber(v) {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function debounce(fn, ms) {
  let t = null;
  const wrapped = function () {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
  wrapped.cancel = function () {
    clearTimeout(t);
  };
  return wrapped;
}

/* ---------------- CM6 panel ---------------- */

class ReferencePanel {
  constructor(view, state, host) {
    this.view = view;
    this.host = host;
    this.state = state;
    this.top = true; // panel sits ABOVE the editor
    this.component = new Component();
    this.pendingHeight = null;

    this.dom = document.createElement("div");
    this.dom.className = "splitref-panel";
    this.dom.style.height = state.height + "px";

    const header = document.createElement("div");
    header.className = "splitref-header";
    const title = document.createElement("span");
    title.className = "splitref-title";
    title.setText(state.refPath.split("/").pop());
    const closeBtn = document.createElement("button");
    closeBtn.className = "splitref-close";
    closeBtn.setText("\u00d7");
    closeBtn.addEventListener("click", () => this.host.requestClose());
    header.appendChild(title);
    header.appendChild(closeBtn);
    this.dom.appendChild(header);

    this.contentEl = document.createElement("div");
    this.contentEl.className = "splitref-content";
    this.dom.appendChild(this.contentEl);

    const handle = document.createElement("div");
    handle.className = "splitref-handle";
    this.dom.appendChild(handle);
    this.attachDrag(handle);

    this.contentEl.addEventListener(
      "scroll",
      () => {
        this.host.onScroll(this.contentEl.scrollTop);
      },
      { passive: true }
    );

    this.component.load();
    this.renderContent(state);
  }

  async renderContent(state) {
    const app = this.host.app;
    const refFile = app.vault.getAbstractFileByPath(state.refPath);
    if (!refFile || !(refFile instanceof TFile)) {
      this.contentEl.className = "splitref-content splitref-error";
      this.contentEl.setText("Missing reference: " + state.refPath);
      this.host.onMissing(state.refPath);
      return;
    }
    let md;
    if (refFile.extension === "pdf") {
      // Q2 probe: does Obsidian's internal PDF viewer render via an embed
      // inside a detached, plugin-owned container?
      md = "![[" + state.refPath + "]]";
    } else {
      md = await app.vault.read(refFile);
    }
    await MarkdownRenderer.render(app, md, this.contentEl, state.refPath, this.component);
    const scrollTop = state.scrollTop || 0;
    if (scrollTop > 0) {
      requestAnimationFrame(() => {
        this.contentEl.scrollTop = scrollTop;
      });
    }
  }

  attachDrag(handle) {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try {
        handle.setPointerCapture(e.pointerId);
      } catch (err) {
        /* older WebKit: capture may fail; drag still works while pressed */
      }
      const startY = e.clientY;
      const startH = this.dom.offsetHeight;
      const move = (ev) => {
        const max = Math.max(Math.floor(this.view.dom.clientHeight * 0.7), 160);
        const h = clamp(startH + (ev.clientY - startY), MIN_HEIGHT, max);
        this.dom.style.height = h + "px";
        this.view.requestMeasure(); // let CM6 relayout around the new height
        this.pendingHeight = h;
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        if (this.pendingHeight) {
          this.host.onHeightEnd(this.pendingHeight);
          this.pendingHeight = null;
        }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  update(_update) {
    // Deliberately empty: fires on every keystroke; must stay cheap.
    // Height changes go straight to the DOM + requestMeasure (no CM dispatch),
    // so the panel is not recreated mid-drag.
  }

  destroy() {
    this.component.unload();
  }
}

function createSplitExtension(host) {
  const splitField = StateField.define({
    create: () => null,
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(setSplitEffect)) value = e.value;
      }
      return value;
    },
    provide: (field) =>
      showPanel.from(field, (value) =>
        value ? (view) => new ReferencePanel(view, value, host) : null
      ),
  });
  return [splitField];
}

/* ---------------- reference picker ---------------- */

class ReferencePickerModal extends FuzzySuggestModal {
  constructor(app, files, onChoose) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
    this.setPlaceholder("Reference file (note or PDF)\u2026");
  }
  getItems() {
    return this.files;
  }
  getItemText(f) {
    return f.path;
  }
  onChooseItem(f) {
    this.onChoose(f);
  }
}

/* ---------------- plugin ---------------- */

module.exports = class SplitReferenceSpikePlugin extends Plugin {
  onload() {
    this.activeSplit = null; // { filePath, refPath, height, scrollTop }
    this.persistDebounced = debounce(() => this.persistNow(), PERSIST_DEBOUNCE_MS);

    const host = {
      app: this.app,
      requestClose: () => {
        this.closeSplit(true);
      },
      onHeightEnd: (h) => {
        if (this.activeSplit) {
          this.activeSplit.height = h;
          this.persistDebounced();
        }
      },
      onScroll: (s) => {
        if (this.activeSplit) {
          this.activeSplit.scrollTop = s;
          this.persistDebounced();
        }
      },
      onMissing: (refPath) => {
        new Notice("Split reference missing: " + refPath + " (state kept)", 6000);
      },
    };

    this.registerEditorExtension(createSplitExtension(host));

    this.addCommand({
      id: "ignite-split",
      name: "Ignite reference split (choose file)",
      callback: () => this.chooseAndIgnite(),
    });
    this.addCommand({
      id: "close-split",
      name: "Close reference split (clears stored state)",
      callback: () => this.closeSplit(true),
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.onFileOpen(file))
    );
  }

  onunload() {
    this.persistDebounced.cancel();
  }

  getActiveCm() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return { view: null, cm: null };
    // NOTE: editor.cm is undocumented API. Acceptable for a spike; a
    // production version should treat this as a compatibility risk.
    const cm = view.editor && view.editor.cm ? view.editor.cm : null;
    return { view, cm };
  }

  chooseAndIgnite() {
    const { view, cm } = this.getActiveCm();
    if (!view) {
      new Notice("Open the note you want to write in first.");
      return;
    }
    if (view.getMode() !== "source") {
      new Notice("Split only ignites in editing mode (Live Preview / Source).");
      return;
    }
    if (!cm) {
      new Notice("No editor instance found (spike limitation).");
      return;
    }
    const files = this.app.vault.getFiles().filter((f) => {
      return (
        f.path !== view.file.path &&
        (f.extension === "md" || f.extension === "pdf")
      );
    });
    new ReferencePickerModal(this.app, files, (f) => {
      this.ignite(view, cm, f.path, true);
    }).open();
  }

  ignite(view, cm, refPath, persist) {
    this.activeSplit = {
      filePath: view.file.path,
      refPath: refPath,
      height: DEFAULT_HEIGHT,
      scrollTop: 0,
    };
    cm.dispatch({
      effects: setSplitEffect.of({
        refPath: refPath,
        height: DEFAULT_HEIGHT,
        scrollTop: 0,
      }),
    });
    if (persist) this.persistNow();
  }

  async closeSplit(clearState) {
    const { cm } = this.getActiveCm();
    if (cm) cm.dispatch({ effects: setSplitEffect.of(null) });
    if (clearState && this.activeSplit) {
      const filePath = this.activeSplit.filePath;
      this.activeSplit = null;
      this.persistDebounced.cancel();
      await this.clearFrontmatter(filePath);
    }
  }

  onFileOpen(file) {
    // Leaving a file: flush its pending state write first.
    if (this.activeSplit && (!file || file.path !== this.activeSplit.filePath)) {
      this.persistDebounced.cancel();
      this.persistNow();
      this.activeSplit = null;
    }
    if (!file) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache && cache.frontmatter;
    const ref = fm ? fm[FM_REFERENCE] : null;
    if (!ref || typeof ref !== "string") return;

    // Let the MarkdownView settle before reaching for its editor.
    setTimeout(() => {
      const { view, cm } = this.getActiveCm();
      if (!view || !view.file || view.file.path !== file.path) return;
      if (view.getMode() !== "source") {
        new Notice("Split restore skipped: note is in reading mode.");
        return;
      }
      if (!cm) return;

      const refFile = this.app.vault.getAbstractFileByPath(ref);
      if (!refFile) {
        new Notice("Split reference missing: " + ref + " (state kept)", 6000);
        return; // state intentionally left in frontmatter
      }

      const h = toNumber(fm[FM_HEIGHT]);
      const s = toNumber(fm[FM_SCROLL]);
      this.activeSplit = {
        filePath: file.path,
        refPath: ref,
        height: h ? clamp(h, MIN_HEIGHT, 2000) : DEFAULT_HEIGHT,
        scrollTop: s || 0,
      };
      cm.dispatch({
        effects: setSplitEffect.of({
          refPath: ref,
          height: this.activeSplit.height,
          scrollTop: this.activeSplit.scrollTop,
        }),
      });
    }, 120);
  }

  async persistNow() {
    const split = this.activeSplit;
    if (!split) return;
    const file = this.app.vault.getAbstractFileByPath(split.filePath);
    if (!file || !(file instanceof TFile)) return;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm[FM_REFERENCE] = split.refPath;
        fm[FM_HEIGHT] = Math.round(split.height);
        fm[FM_SCROLL] = Math.round(split.scrollTop);
      });
    } catch (err) {
      console.error("split-reference-spike: persist failed", err);
    }
  }

  async clearFrontmatter(filePath) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        delete fm[FM_REFERENCE];
        delete fm[FM_HEIGHT];
        delete fm[FM_SCROLL];
      });
    } catch (err) {
      console.error("split-reference-spike: clear failed", err);
    }
  }
};
