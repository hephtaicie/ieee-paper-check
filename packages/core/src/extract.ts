// SPDX-License-Identifier: MIT
import { loadPdfjs } from "./pdfjs-env.ts";
import type { FontInfo, PageLine, PaperData } from "./types.ts";

interface TextItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
  fontName: string;
}

/** Glyph of a showText op (pdf.js pre-resolves the font encoding). */
interface ShowTextGlyph {
  unicode?: string;
}

interface CompatFont {
  name: string;
  isType3Font: boolean;
  missingFile: boolean;
}

interface PageLike {
  view: unknown;
  commonObjs: { get: (k: string) => unknown };
}

interface LinePart {
  str: string;
  x: number;
  w: number;
  color?: string;
}

interface LineAcc {
  parts: LinePart[];
  x0: number;
  yTop: number;
  width: number;
  height: number;
  dominant: TextItem;
  dominantW: number;
  color?: string;
}

function fontFromCommon(page: PageLike, ref: string): CompatFont | undefined {
  try {
    const f = page.commonObjs.get(ref) as CompatFont | undefined;
    if (f && typeof f.name === "string") return f;
  } catch {
    // Font object not resolved (yet): fall back to the raw reference.
  }
  return undefined;
}

/** Open a PDF from bytes and extract all data the checks need. */
export async function extractPaperData(bytes: Uint8Array): Promise<PaperData> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: bytes,
    verbosity: 0,
    disableFontFace: true,
  }).promise;

  const lines: PageLine[] = [];
  const fonts: FontInfo[] = [];
  const seenFonts = new Set<string>();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = (await doc.getPage(p)) as unknown as PageLike & {
      getTextContent: () => Promise<{ items: TextItem[] }>;
      getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
    };
    const view = page.view as [number, number, number, number];
    const pageWidth = view[2] - view[0];
    const pageHeight = view[3] - view[1];

    // Running the operator list first compiles every font used on the
    // page, so commonObjs lookups afterwards are resolved.
    const opList = await page.getOperatorList();

    // --- per-run fill colors ---------------------------------------------
    // The worker normalizes every fill-colour operator (rg, g, k, sc(n))
    // to setFillRGBColor with a hex argument, so tracking just that op
    // covers all colour spaces. Text inside Form XObjects (included
    // figures) never reaches this op list, so it never counts as
    // coloured body text. Rotated runs (y-axis labels of full-page
    // figure sheets) are skipped: they reorder against the text items.
    const LIGATURES: Record<string, string> = {
      "\uFB00": "ff",
      "\uFB01": "fi",
      "\uFB02": "fl",
      "\uFB03": "ffi",
      "\uFB04": "ffl",
    };
    const runColors: (string | undefined)[] = [];
    const runCharLens: number[] = [];
    {
      const SHOW = new Set([
        pdfjs.OPS.showText,
        pdfjs.OPS.showSpacedText,
        pdfjs.OPS.nextLineShowText,
        pdfjs.OPS.nextLineSetSpacingShowText,
      ]);
      let fill = "#000000";
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i]!;
        if (fn === pdfjs.OPS.setFillRGBColor) {
          const c = opList.argsArray[i]?.[0];
          fill = typeof c === "string" ? c : "#000000";
        } else if (fn === pdfjs.OPS.setFillTransparent) {
          fill = "#000000";
        } else if (SHOW.has(fn)) {
          const arg = opList.argsArray[i]?.[0];
          let str = "";
          if (typeof arg === "string") str = arg;
          else if (Array.isArray(arg)) {
            for (const g of arg as (ShowTextGlyph | number)[]) {
              if (typeof g === "number") continue; // kerning offset
              if (g.unicode) str += g.unicode;
            }
          }
          // Drop whitespace-only runs (absent from the text items) and
          // ligature-expand so lengths match the item stream.
          str = str.replace(/[\uFB00-\uFB04]/g, (m) => LIGATURES[m] ?? m);
          if (str.trim().length > 0) {
            runColors.push(fill);
            runCharLens.push(str.replace(/\s+/g, "").length);
          }
        }
      }
    }

    const refs: string[] = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      if (opList.fnArray[i] === pdfjs.OPS.setFont) {
        const ref = opList.argsArray[i]?.[0] as string | undefined;
        if (ref && !refs.includes(ref)) refs.push(ref);
      }
    }
    for (const ref of refs) {
      const key = `${p}:${ref}`;
      if (seenFonts.has(key)) continue;
      const f = fontFromCommon(page, ref);
      if (!f) continue;
      seenFonts.add(key);
      fonts.push({
        page: p,
        name: f.name,
        type3: f.isType3Font,
        embedded: !f.missingFile,
      });
    }

    // --- positioned text lines ------------------------------------------
    const tc = await page.getTextContent();
    // Walk the show-text runs alongside the text items: both come from
    // the same content stream in the same order. Whitespace-only runs
    // never reach the items, and pdf.js may split one run into several
    // items (synthetic spaces at kerning gaps), so runs are consumed
    // greedily: an item takes characters from the current run until it
    // is exhausted, then opens the next one. Each item inherits the
    // colour of the run its FIRST character belongs to.
    let runIdx = 0;
    let runCharsLeft = 0;
    let curColor: string | undefined;
    const normLen = (s: string) => s.replace(/\s+/g, "").length;
    const nextRunColor = (): string | undefined => {
      if (runCharsLeft <= 0) {
        if (runIdx >= runColors.length) return undefined;
        curColor = runColors[runIdx]!;
        runCharsLeft = runCharLens[runIdx]!;
        runIdx++;
      }
      return curColor;
    };
    const consumeChars = (n: number): void => {
      runCharsLeft -= n;
    };
    let line: LineAcc | null = null;
    const flush = () => {
      if (line === null) return;
      // Join runs with a space when there is a positional gap between
      // them (pdf.js splits at style changes, e.g. "1st" + "Anonymous").
      let text = "";
      let prevX1: number | null = null;
      for (const part of line.parts) {
        if (prevX1 !== null && part.x - prevX1 > 0.75) text += " ";
        text += part.str;
        prevX1 = part.x + part.w;
      }
      if (text.trim().length > 0) {
        const f = fontFromCommon(page, line.dominant.fontName);
        lines.push({
          page: p,
          text,
          x: line.x0,
          y: line.yTop,
          w: line.width,
          h: line.height,
          font: f?.name ?? line.dominant.fontName,
          size: line.dominant.height,
          color: line.color,
          pageWidth,
          pageHeight,
        });
      }
      line = null;
    };

    for (const raw of tc.items) {
      const tr = raw.transform;
      if (raw.str.trim().length === 0) continue;
      // Non-empty, non-rotated items consume run characters. Rotated
      // items (vertical axis labels) come out of order relative to the
      // op list; skipping them keeps the streams aligned, and rotated
      // text only appears on figure sheets anyway.
      const rotated = Math.abs(tr[1] ?? 0) > 0.01 || Math.abs(tr[2] ?? 0) > 0.01;
      const color = rotated ? undefined : nextRunColor();
      if (!rotated) consumeChars(normLen(raw.str));
      const baseline = tr[5] ?? 0;
      const height = raw.height || Math.abs(tr[3] ?? 0) || 10;
      const x = tr[4] ?? 0;
      const yTop = pageHeight - baseline - height;
      const sameLine =
        line !== null &&
        Math.abs(yTop - line.yTop) < 3 &&
        Math.abs(x - (line.x0 + line.width)) < 24;
      if (sameLine && line !== null) {
        line.parts.push({ str: raw.str, x, w: raw.width, color });
        const right = x + raw.width;
        if (right > line.x0 + line.width) line.width = right - line.x0;
        if (raw.width > line.dominantW) {
          line.dominant = raw;
          line.dominantW = raw.width;
        }
        // A line keeps its first color; a run that differs (e.g. one red
        // word inside a black line) wins so the line is not missed.
        if (color && !line.color) line.color = color;
      } else {
        flush();
        line = {
          parts: [{ str: raw.str, x, w: raw.width, color }],
          x0: x,
          yTop,
          width: raw.width,
          height,
          dominant: raw,
          dominantW: raw.width,
          color,
        };
      }
    }
    flush();
  }

  const first = lines.find((l) => l.page === 1);
  return {
    pageCount: doc.numPages,
    pageWidth: first?.pageWidth ?? 612,
    pageHeight: first?.pageHeight ?? 792,
    lines,
    fonts,
  };
}
