// SPDX-License-Identifier: MIT

import type { PreviewRegion } from "@ieee-check/core";
import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

/** Renders selected PDF page crops into a local carousel; no image data is
 * uploaded or persisted. */
export class PdfPreviewCarousel {
  private readonly dialog = document.createElement("dialog");
  private readonly heading = document.createElement("span");
  private readonly counter = document.createElement("span");
  private readonly canvas = document.createElement("canvas");
  private readonly previous = document.createElement("button");
  private readonly next = document.createElement("button");
  private readonly closeButton = document.createElement("button");
  private readonly docs = new Map<string, Promise<PDFDocumentProxy>>();
  private current: { file: string; regions: PreviewRegion[]; index: number } | null = null;
  private renderToken = 0;

  constructor(
    private readonly pdfjs: PdfJs,
    private readonly getBytes: (file: string) => Uint8Array | undefined,
  ) {
    this.dialog.className = "preview-dialog";
    this.dialog.setAttribute("aria-label", "Paper visual previews");
    this.dialog.tabIndex = -1;
    const header = document.createElement("div");
    header.className = "preview-head";
    this.heading.className = "preview-title";
    this.previous.type = "button";
    this.previous.textContent = "Previous";
    this.next.type = "button";
    this.next.textContent = "Next";
    this.closeButton.type = "button";
    this.closeButton.textContent = "Close";
    this.counter.className = "muted";
    header.append(this.heading, this.counter, this.previous, this.next, this.closeButton);
    const body = document.createElement("div");
    body.className = "preview-body";
    body.append(this.canvas);
    this.dialog.append(header, body);
    document.body.append(this.dialog);

    this.previous.addEventListener("click", () => this.navigate(-1));
    this.next.addEventListener("click", () => this.navigate(1));
    this.closeButton.addEventListener("click", () => this.close());
    this.dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.navigate(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        this.navigate(1);
      }
    });
    this.dialog.addEventListener("click", (event) => {
      if (event.target === this.dialog) this.close();
    });
    this.dialog.addEventListener("close", () => {
      this.current = null;
    });
  }

  open(file: string, regions: PreviewRegion[]): void {
    if (regions.length === 0) return;
    this.current = { file, regions, index: 0 };
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.focus();
    void this.render();
  }

  close(): void {
    this.renderToken++;
    if (this.dialog.open) this.dialog.close();
    this.current = null;
    const ctx = this.canvas.getContext("2d");
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private navigate(delta: number): void {
    if (!this.current) return;
    this.current.index = Math.max(
      0,
      Math.min(this.current.regions.length - 1, this.current.index + delta),
    );
    void this.render();
  }

  private document(file: string): Promise<PDFDocumentProxy> {
    let promise = this.docs.get(file);
    if (!promise) {
      const bytes = this.getBytes(file);
      if (!bytes) return Promise.reject(new Error(`No PDF data retained for ${file}`));
      promise = this.pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
      this.docs.set(file, promise);
    }
    return promise;
  }

  private async render(): Promise<void> {
    const item = this.current;
    if (!item) return;
    const token = ++this.renderToken;
    const region = item.regions[item.index]!;
    this.heading.textContent = `${region.label} — ${item.file}`;
    this.counter.textContent = `${item.index + 1} / ${item.regions.length}`;
    this.previous.disabled = item.index === 0;
    this.next.disabled = item.index === item.regions.length - 1;
    try {
      const doc = await this.document(item.file);
      const page = await doc.getPage(region.page);
      const viewport = page.getViewport({ scale: 1.5 });
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = Math.ceil(viewport.width);
      pageCanvas.height = Math.ceil(viewport.height);
      const pageContext = pageCanvas.getContext("2d");
      if (!pageContext) throw new Error("Could not create PDF preview canvas");
      await page.render({ canvas: pageCanvas, canvasContext: pageContext, viewport }).promise;
      if (token !== this.renderToken || !this.current) return;

      const box = viewport.viewBox;
      const pageHeight = box[3]! - box[1]!;
      const bottomY = box[1]! + pageHeight - region.rect.y - region.rect.h;
      const topY = box[1]! + pageHeight - region.rect.y;
      const p0 = viewport.convertToViewportPoint(region.rect.x, bottomY);
      const p1 = viewport.convertToViewportPoint(region.rect.x + region.rect.w, topY);
      const sx = Math.max(0, Math.min(p0[0]!, p1[0]!));
      const sy = Math.max(0, Math.min(p0[1]!, p1[1]!));
      const ex = Math.min(pageCanvas.width, Math.max(p0[0]!, p1[0]!));
      const ey = Math.min(pageCanvas.height, Math.max(p0[1]!, p1[1]!));
      const sw = Math.max(1, ex - sx);
      const sh = Math.max(1, ey - sy);
      const maxWidth = Math.min(window.innerWidth - 48, 1100);
      const scale = Math.min(1, maxWidth / sw);
      this.canvas.width = Math.ceil(sw * scale);
      this.canvas.height = Math.ceil(sh * scale);
      const ctx = this.canvas.getContext("2d");
      if (!ctx) throw new Error("Could not draw PDF preview crop");
      ctx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, this.canvas.width, this.canvas.height);
    } catch (error) {
      this.heading.textContent = `${region.label} — ${(error as Error).message}`;
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
  }
}
