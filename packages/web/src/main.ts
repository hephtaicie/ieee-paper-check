// SPDX-License-Identifier: MIT
import type { PaperReport, Rect } from "@ieee-check/core";
import { CHECK_LABELS, CHECK_ORDER, DEFAULT_CONFIG, renderCsv, validate } from "@ieee-check/core";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PdfViewer } from "./viewer.ts";

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el as T;
}

const dropzone = byId<HTMLButtonElement>("dropzone");
const fileInput = byId<HTMLInputElement>("file-input");
const results = byId<HTMLDivElement>("results");
const actions = byId<HTMLDivElement>("actions");
const summary = byId<HTMLSpanElement>("summary");
const csvBtn = byId<HTMLButtonElement>("csv-btn");
const clearBtn = byId<HTMLButtonElement>("clear-btn");

const reports: PaperReport[] = [];
const pdfBytes = new Map<string, Uint8Array>();

// Configure the pdf.js worker before any document is opened.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const viewer = new PdfViewer(
  pdfjs,
  {
    dialog: byId<HTMLDialogElement>("viewer"),
    title: byId<HTMLSpanElement>("v-title"),
    pageLabel: byId<HTMLSpanElement>("v-page"),
    prev: byId<HTMLButtonElement>("v-prev"),
    next: byId<HTMLButtonElement>("v-next"),
    close: byId<HTMLButtonElement>("v-close"),
    canvas: byId<HTMLCanvasElement>("v-canvas"),
    hl: byId<HTMLDivElement>("v-hl"),
  },
  (file) => pdfBytes.get(file),
);

// Clicking an evidence row opens the viewer on the referenced page,
// with the highlight rectangle when the check knows the geometry.
results.addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>(".check.viewable");
  if (row === null) return;
  const file = row.dataset.file;
  const page = row.dataset.page;
  if (file === undefined || page === undefined || !pdfBytes.has(file)) return;
  let rect: Rect | undefined;
  try {
    rect = row.dataset.rect ? (JSON.parse(row.dataset.rect) as Rect) : undefined;
  } catch {
    rect = undefined;
  }
  viewer.open(file, Number.parseInt(page, 10), rect);
});

function downloadCsv(): void {
  const blob = new Blob([renderCsv(reports)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ieee-check-report.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function refreshActions(): void {
  if (reports.length === 0) {
    actions.hidden = true;
    return;
  }
  actions.hidden = false;
  const valid = reports.filter((r) => r.valid).length;
  summary.textContent = `${valid} valid · ${reports.length - valid} invalid · ${reports.length} total`;
}

function esc(s: string): string {
  const d = document.createElement("span");
  d.textContent = s;
  return d.innerHTML;
}

function reportCard(r: PaperReport): HTMLElement {
  const card = document.createElement("article");
  card.className = `card ${r.valid ? "valid" : "invalid"}`;

  const head = document.createElement("div");
  head.className = "card-head";
  const badge = r.valid ? "✓ VALID" : "✗ INVALID";
  head.innerHTML = `<span class="badge">${badge}</span><span class="fname">${esc(r.file)}</span><span class="pages">${r.pageCount} pages</span>`;
  card.append(head);

  const grid = document.createElement("div");
  grid.className = "checks";
  for (const id of CHECK_ORDER) {
    const c = r.results.find((x) => x.id === id);
    if (c === undefined) continue; // disabled via config: no row at all
    const row = document.createElement("div");
    row.className = `check ${c.status.toLowerCase()}`;
    const label = CHECK_LABELS[id];
    // Only failures open the viewer: a passing check is inert so a
    // green card reads as nothing to inspect.
    const located = c.status === "FAIL" ? c.evidence.find((e) => e.page !== undefined) : undefined;
    if (c.status === "PASS") {
      // Passing checks stay quiet; the evidence (e.g. the found title
      // or the References accounting) is one click away in the viewer.
      row.innerHTML = `<span class="mark">✓</span><span class="label">${esc(label)}</span>`;
    } else {
      const ev = c.evidence
        .map((e) => `${e.page ? `[p.${e.page}] ` : ""}${esc(e.detail)}`)
        .join("<br>");
      row.innerHTML = `<span class="mark">✗</span><span class="label">${esc(label)}</span><span class="evidence">${ev}</span>`;
      row.classList.add("has-evidence");
    }
    if (located !== undefined) {
      row.classList.add("viewable");
      row.title = "Click to view this page";
      row.dataset.file = r.file;
      row.dataset.page = String(located.page);
      if (located.rect !== undefined) {
        row.dataset.rect = JSON.stringify(located.rect);
      }
    }
    grid.append(row);
  }
  card.append(grid);
  return card;
}

async function handleFiles(files: FileList | File[]): Promise<void> {
  for (const f of Array.from(files)) {
    if (!f.name.toLowerCase().endsWith(".pdf")) continue;
    let card: HTMLElement | null = null;
    try {
      // Await the WASM backend (already imported at module load).
      const bytes = new Uint8Array(await f.arrayBuffer());
      // pdf.js transfers (detaches) the buffer passed to validate, so
      // keep an independent copy for the viewer.
      pdfBytes.set(f.name, bytes.slice());
      const r = await validate(bytes, f.name, DEFAULT_CONFIG);
      reports.push(r);
      card = reportCard(r);
    } catch (e) {
      const err = document.createElement("article");
      err.className = "card invalid";
      err.innerHTML = `<div class="card-head"><span class="badge">ERROR</span><span class="fname">${esc(f.name)}</span></div><div class="checks"><div class="check fail has-evidence"><span class="mark">✗</span><span class="label">Could not analyse this PDF</span><span class="evidence">${esc((e as Error).message)}</span></div></div>`;
      card = err;
    }
    results.append(card);
  }
  refreshActions();
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});
fileInput.addEventListener("change", () => {
  void handleFiles(fileInput.files ?? []);
  fileInput.value = "";
});

for (const ev of ["dragenter", "dragover"]) {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  });
}
for (const ev of ["dragleave", "drop"]) {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
  });
}
dropzone.addEventListener("drop", (e) => {
  void handleFiles(e.dataTransfer?.files ?? []);
});

csvBtn.addEventListener("click", downloadCsv);
clearBtn.addEventListener("click", () => {
  reports.length = 0;
  pdfBytes.clear();
  results.replaceChildren();
  refreshActions();
});
