// SPDX-License-Identifier: MIT
import type { Config, PaperReport, Rect } from "@ieee-check/core";
import { CHECK_LABELS, CHECK_ORDER, renderCsv, validate } from "@ieee-check/core";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PdfViewer } from "./viewer.ts";

export interface AppElements {
  dropzone: HTMLButtonElement;
  fileInput: HTMLInputElement;
  results: HTMLDivElement;
  actions: HTMLDivElement;
  summary: HTMLSpanElement;
  csvBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  viewer: HTMLDialogElement;
  vTitle: HTMLSpanElement;
  vPage: HTMLSpanElement;
  vPrev: HTMLButtonElement;
  vNext: HTMLButtonElement;
  vClose: HTMLButtonElement;
  vCanvas: HTMLCanvasElement;
  vHl: HTMLDivElement;
}

function esc(s: string): string {
  const d = document.createElement("span");
  d.textContent = s;
  return d.innerHTML;
}

export interface App {
  readonly reports: PaperReport[];
  readonly pdfBytes: Map<string, Uint8Array>;
  /** Rebuild the report cards from the stored reports. */
  rerender(): void;
  /** Re-run every stored PDF under the current config and re-render. */
  revalidate(): Promise<void>;
  clear(): void;
}

/** Shared dropzone/report UI used by both the public app and the admin
 * app. `getConfig` is consulted for every validation, so the admin page
 * can change the configuration dynamically. `augmentCard` decorates
 * each report card after it is built (e.g. admin mailto buttons);
 * `onReportsChanged` fires whenever the stored reports change. */
export function mountApp(
  el: AppElements,
  getConfig: () => Config,
  augmentCard?: (r: PaperReport, card: HTMLElement) => void,
  onReportsChanged?: () => void,
): App {
  const reports: PaperReport[] = [];
  let revalidateRun = 0;
  const pdfBytes = new Map<string, Uint8Array>();

  // Configure the pdf.js worker before any document is opened.
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const viewer = new PdfViewer(
    pdfjs,
    {
      dialog: el.viewer,
      title: el.vTitle,
      pageLabel: el.vPage,
      prev: el.vPrev,
      next: el.vNext,
      close: el.vClose,
      canvas: el.vCanvas,
      hl: el.vHl,
    },
    (file) => pdfBytes.get(file),
  );

  // Clicking an evidence row opens the viewer on the referenced page,
  // with the highlight rectangle when the check knows the geometry.
  el.results.addEventListener("click", (e) => {
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
      el.actions.hidden = true;
      return;
    }
    el.actions.hidden = false;
    const valid = reports.filter((r) => r.valid).length;
    el.summary.textContent = `${valid} valid · ${reports.length - valid} invalid · ${reports.length} total`;
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
      const located =
        c.status === "FAIL" ? c.evidence.find((e) => e.page !== undefined) : undefined;
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
    augmentCard?.(r, card);
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
        const r = await validate(bytes, f.name, getConfig());
        reports.push(r);
        card = reportCard(r);
      } catch (e) {
        const err = document.createElement("article");
        err.className = "card invalid";
        err.innerHTML = `<div class="card-head"><span class="badge">ERROR</span><span class="fname">${esc(f.name)}</span></div><div class="checks"><div class="check fail has-evidence"><span class="mark">✗</span><span class="label">Could not analyse this PDF</span><span class="evidence">${esc((e as Error).message)}</span></div></div>`;
        card = err;
      }
      el.results.append(card);
    }
    refreshActions();
    onReportsChanged?.();
  }

  async function revalidate(): Promise<void> {
    if (pdfBytes.size === 0) return;
    // Revalidations race when settings change quickly; only the latest
    // run may touch the DOM.
    const run = ++revalidateRun;
    // validate() detaches the buffer it receives, so hand it a fresh
    // copy of the stored bytes each round.
    const fresh: PaperReport[] = [];
    for (const [name, bytes] of pdfBytes) {
      const r = await validate(bytes.slice(), name, getConfig());
      if (run !== revalidateRun) return;
      fresh.push(r);
    }
    reports.length = 0;
    reports.push(...fresh);
    el.results.replaceChildren(...fresh.map(reportCard));
    refreshActions();
    onReportsChanged?.();
  }

  el.dropzone.addEventListener("click", () => el.fileInput.click());
  el.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") el.fileInput.click();
  });
  el.fileInput.addEventListener("change", () => {
    void handleFiles(el.fileInput.files ?? []);
    el.fileInput.value = "";
  });

  for (const ev of ["dragenter", "dragover"]) {
    el.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      el.dropzone.classList.add("drag");
    });
  }
  for (const ev of ["dragleave", "drop"]) {
    el.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      el.dropzone.classList.remove("drag");
    });
  }
  el.dropzone.addEventListener("drop", (e) => {
    void handleFiles(e.dataTransfer?.files ?? []);
  });

  el.csvBtn.addEventListener("click", downloadCsv);
  el.clearBtn.addEventListener("click", () => {
    clear();
  });

  function clear(): void {
    reports.length = 0;
    pdfBytes.clear();
    el.results.replaceChildren();
    refreshActions();
    onReportsChanged?.();
  }

  /** Rebuild the report cards from the stored reports (e.g. after an
   * admin-side change to the email template or author list). */
  function rerender(): void {
    el.results.replaceChildren(...reports.map(reportCard));
  }

  return { reports, pdfBytes, rerender, revalidate, clear };
}

export { esc };
