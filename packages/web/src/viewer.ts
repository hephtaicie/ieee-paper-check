// SPDX-License-Identifier: MIT
import type { Rect } from "@ieee-check/core";
import type { PDFDocumentProxy } from "pdfjs-dist";

interface ViewerHost {
  dialog: HTMLDialogElement;
  title: HTMLElement;
  pageLabel: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  close: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  hl: HTMLDivElement;
}

/** Minimal PDF viewer: renders one page at a time with an optional
 * highlight rectangle, on the same pdf.js instance as the checks. */
export class PdfViewer {
  private current: { file: string; page: number; rect?: Rect } | null = null;
  private docs = new Map<string, Promise<PDFDocumentProxy>>();

  constructor(
    private readonly pdfjs: typeof import("pdfjs-dist"),
    private readonly host: ViewerHost,
    private readonly getBytes: (file: string) => Uint8Array | undefined,
  ) {
    host.dialog.tabIndex = -1;
    host.close.addEventListener("click", () => this.close());
    host.prev.addEventListener("click", () => this.navigate(-1));
    host.next.addEventListener("click", () => this.navigate(1));
    host.dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.navigate(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        this.navigate(1);
      }
    });
  }

  open(file: string, page: number, rect?: Rect): void {
    this.current = { file, page, rect };
    void this.render();
  }

  close(): void {
    this.host.dialog.close();
    this.current = null;
  }

  private navigate(delta: number): void {
    if (this.current === null) return;
    this.current.page += delta;
    this.current.rect = undefined;
    void this.render();
  }

  private doc(file: string): Promise<PDFDocumentProxy> {
    let d = this.docs.get(file);
    if (d === undefined) {
      const bytes = this.getBytes(file);
      if (bytes === undefined) {
        return Promise.reject(new Error(`no bytes for ${file}`));
      }
      d = this.pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
      this.docs.set(file, d);
    }
    return d;
  }

  private async render(): Promise<void> {
    const c = this.current;
    if (c === null) return;
    const { dialog, title, pageLabel, canvas, hl } = this.host;
    if (!dialog.open) dialog.showModal();
    dialog.focus();
    try {
      const d = await this.doc(c.file);
      const page = Math.min(Math.max(1, c.page), d.numPages);
      const p = await d.getPage(page);
      // Measure the dialog, not the canvas stage: the stage is
      // fit-content around the canvas, so its width depends on what
      // was rendered before this call.
      const available = Math.min(dialog.clientWidth - 32, 880);
      const base = p.getViewport({ scale: 1 });
      const scale = Math.max(0.5, available / base.width);
      const viewport = p.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2d context");
      await p.render({ canvas, viewport }).promise;

      if (c.rect !== undefined) {
        // Evidence rects are top-origin (y grows downward, as the
        // checks extract them); pdf.js user space is bottom-origin.
        // Flip before mapping to the viewport.
        const bY0 = viewport.viewBox[1]!;
        const pageH = viewport.viewBox[3]! - bY0;
        const userY0 = bY0 + (pageH - (c.rect.y + c.rect.h));
        const userY1 = bY0 + (pageH - c.rect.y);
        const [px, py] = viewport.convertToViewportPoint(c.rect.x, userY0);
        const [px2, py2] = viewport.convertToViewportPoint(c.rect.x + c.rect.w, userY1);
        hl.style.left = `${Math.min(px, px2) - 4}px`;
        hl.style.top = `${Math.min(py, py2) - 4}px`;
        hl.style.width = `${Math.abs(px2 - px) + 8}px`;
        hl.style.height = `${Math.abs(py2 - py) + 8}px`;
        hl.hidden = false;
      } else {
        hl.hidden = true;
      }

      title.textContent = c.file;
      pageLabel.textContent = `${page} / ${d.numPages}`;
      this.host.prev.disabled = page <= 1;
      this.host.next.disabled = page >= d.numPages;
    } catch (e) {
      title.textContent = `${c.file} — viewer error: ${(e as Error).message}`;
      hl.hidden = true;
    }
  }
}
