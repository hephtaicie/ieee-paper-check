// SPDX-License-Identifier: MIT
import type { CheckId, CheckResult, Config, Evidence, PageLine, PaperData, Rect } from "./types.ts";

function lineRect(l: PageLine): Rect {
  return { x: l.x, y: l.y, w: l.w, h: l.h };
}

function unionRects(lines: PageLine[]): Rect | undefined {
  if (lines.length === 0) return undefined;
  const x = Math.min(...lines.map((l) => l.x));
  const y = Math.min(...lines.map((l) => l.y));
  return {
    x,
    y,
    w: Math.max(...lines.map((l) => l.x + l.w)) - x,
    h: Math.max(...lines.map((l) => l.y + l.h)) - y,
  };
}

const result = (id: CheckId, status: CheckResult["status"], evidence: Evidence[]): CheckResult => ({
  id,
  status,
  evidence,
});

/** Main words must *begin with* a capital letter; the rest of the word
 * may be mixed case (typical for system names). The chair's criterion
 * is the initial capital, not strict Title Case. */
function startsWithUpper(w: string): boolean {
  const c = w.charAt(0);
  return c !== c.toLowerCase() && c === c.toUpperCase();
}

/* ------------------------------ 1. copyright ----------------------------- */

const ISBN_RE = /9\d{2}[- ]\d{1,6}[- ]\d{4}[- ]\d{4}[- ]\d/;
const PRICE_RE = /\/\d{2}\/\$\d{2}\.\d{2}/;
const COPYYEAR_RE = /(©|\(c\)|copyright)\s*\d{4}/i;
const IEEE_RE = /\bIEEE\b/;
const PLACEHOLDER_RE = /X{2,3}[- ]X[- ]X{4}[- ]X{4}[- ]X\/XX\/\$XX\.00/;

export function checkCopyright(data: PaperData): CheckResult {
  const H = data.pageHeight;
  const zone = data.lines.filter(
    (l) => l.page === 1 && l.y > H * 0.85 && l.x < data.pageWidth * 0.5,
  );
  const joined = zone.map((l) => l.text).join(" ");
  if (PLACEHOLDER_RE.test(joined)) {
    const ph = zone.find((l) => PLACEHOLDER_RE.test(l.text));
    return result("copyright", "FAIL", [
      {
        page: 1,
        detail: "Copyright placeholder (XXX-…) not replaced with real IEEE notice",
        rect: ph ? lineRect(ph) : undefined,
      },
    ]);
  }
  const ok =
    ISBN_RE.test(joined) &&
    PRICE_RE.test(joined) &&
    COPYYEAR_RE.test(joined) &&
    IEEE_RE.test(joined);
  if (ok) return result("copyright", "PASS", []);
  return result("copyright", "FAIL", [
    {
      page: 1,
      detail:
        "No complete IEEE copyright block found in the bottom-left corner of page 1 " +
        "(expected e.g. 978-1-6654-1234-5/25/$31.00 © 2025 IEEE)",
      rect: {
        x: 36,
        y: H * 0.85,
        w: data.pageWidth * 0.5,
        h: H * 0.15,
      },
    },
  ]);
}

/* -------------------------------- 2. title ------------------------------- */

const SMALL_CAPS_RE = /[\u1D00-\u1D7F]/;

interface TitleAnalysis {
  text: string;
  fonts: Set<string>;
  rect?: Rect;
}

function findTitle(data: PaperData): TitleAnalysis {
  const p1 = data.lines.filter((l) => l.page === 1);
  if (p1.length === 0) return { text: "", fonts: new Set() };
  const maxSize = Math.max(...p1.map((l) => l.size));
  // Boundary: first author/affiliation/abstract marker below the title zone.
  let boundaryY = data.pageHeight * 0.4;
  for (const l of p1) {
    if (
      l.text.includes("@") ||
      /^abstract\b/i.test(l.text.trim()) ||
      /^paper\s*id/i.test(l.text.trim()) ||
      /\banonymous\b/i.test(l.text)
    ) {
      boundaryY = Math.min(boundaryY, l.y);
    }
  }
  const candidates = p1
    .filter((l) => l.size >= maxSize * 0.75 && l.y < boundaryY)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const fonts = new Set(candidates.map((l) => l.font));
  return {
    text: candidates.map((l) => l.text.trim()).join(" "),
    fonts,
    rect: unionRects(candidates),
  };
}

function casingProblems(words: string[], config: Config): Evidence[] {
  const problems: Evidence[] = [];
  if (words.length === 0) {
    problems.push({ detail: "No title found on page 1" });
    return problems;
  }
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!/[A-Za-z]/.test(word) || /\d/.test(word)) continue;
    const isSmall = config.smallWords.includes(word.toLowerCase());
    // Edge words (title start/end, and the first word of a colon
    // subtitle, e.g. "…: A Feasibility Study") keep their capital.
    const prevEndsColon = i > 0 && /:\s*$/.test(words[i - 1]!);
    const isEdge = i === 0 || i === words.length - 1 || prevEndsColon;
    if (isSmall && !isEdge) {
      if (word !== word.toLowerCase()) {
        problems.push({
          detail: `'${word}' is a small word and must be lowercase ('${word.toLowerCase()}')`,
        });
      }
      continue;
    }
    if (config.acronyms.includes(word)) continue;
    // Short all-caps words (<= 5 letters) are treated as acronyms:
    // camera-ready titles routinely name systems in caps, while
    // reviewers still flag longer shouty all-caps words.
    // Longer acronyms belong in config.acronyms.
    if (!isSmall && word.length <= 5 && word === word.toUpperCase()) continue;
    // Main word (or edge small word, or compound parts).
    const parts = word.split("-");
    if (parts.length > 1) {
      parts.forEach((part, j) => {
        if (!/[A-Za-z]/.test(part)) return;
        const partIsSmall =
          config.smallWords.includes(part.toLowerCase()) && j !== 0 && j !== parts.length - 1;
        if (partIsSmall) {
          if (part !== part.toLowerCase()) {
            problems.push({ detail: `In '${word}', '${part}' must be lowercase` });
          }
        } else if (!startsWithUpper(part)) {
          problems.push({ detail: `'${part}' in '${word}' must start with a capital letter` });
        }
      });
      continue;
    }
    if (!startsWithUpper(word)) {
      problems.push({ detail: `'${word}' must start with a capital letter` });
    }
  }
  return problems;
}

export function checkTitle(data: PaperData, config: Config): CheckResult {
  const title = findTitle(data);
  const problems: Evidence[] = [];

  if (title.text.length === 0) {
    return result("title", "FAIL", [{ page: 1, detail: "No title found on page 1" }]);
  }

  // Small caps: Unicode codepoints, font names, and all-caps rendering.
  if (SMALL_CAPS_RE.test(title.text)) {
    problems.push({ page: 1, detail: "Title contains Unicode small-caps codepoints" });
  }
  for (const f of title.fonts) {
    if (/caps|csc/i.test(f)) {
      problems.push({ page: 1, detail: `Title uses a small-caps font: '${f}'` });
    }
  }
  const letters = title.text.replace(/[^A-Za-z]/g, "");
  const upperRatio =
    letters.length > 0
      ? letters.split("").filter((c) => c === c.toUpperCase()).length / letters.length
      : 0;
  const words = title.text.split(/\s+/).filter(Boolean);
  const wordCount = words.filter((w) => /[A-Za-z]/.test(w)).length;
  const titleLooksAllCaps = upperRatio > 0.9 && wordCount >= 3;
  if (titleLooksAllCaps) {
    problems.push({
      page: 1,
      detail:
        "Title renders in all capitals (all-caps or small-caps); " +
        "main words must be Title Case with small words lowercase",
    });
  }

  problems.push(...casingProblems(words, config));

  for (const e of problems) {
    e.page = 1;
    e.rect = title.rect;
  }
  if (problems.length === 0) {
    return result("title", "PASS", [
      { page: 1, detail: `Title: '${title.text}'`, rect: title.rect },
    ]);
  }
  return result("title", "FAIL", problems);
}

/* ---------------------------- 3. artifact appendix ----------------------- */

const ARTIFACT_RE = /\bartifacts?\s+(description|evaluation|appendix|badges?)/i;

export function checkArtifactAppendix(data: PaperData): CheckResult {
  const hits = data.lines.filter((l) => ARTIFACT_RE.test(l.text));
  if (hits.length === 0) {
    return result("artifact_appendix", "PASS", []);
  }
  return result("artifact_appendix", "FAIL", [
    {
      page: hits[0]!.page,
      detail: `Paper must not contain an Artifact Description/Evaluation section (found: '${hits[0]!.text.trim().slice(0, 80)}')`,
      rect: lineRect(hits[0]!),
    },
  ]);
}

/* ------------------------------ 3b. appendix ----------------------------- */

const APPENDIX_RE = /^appendix\b|^appendices\b/i;

/**
 * Appendices are forbidden in the paper: they must be submitted
 * separately. Detects IEEEtran-style "Appendix A" headings as well as
 * generic appendix section titles, before or after the references.
 */
export function checkAppendix(data: PaperData, config: Config): CheckResult {
  if (!config.forbidAppendices) {
    return result("appendix", "PASS", []);
  }
  const heading = data.lines.find((l) => {
    if (!APPENDIX_RE.test(l.text.trim())) return false;
    // Heading-like: short line, not a full sentence.
    return l.text.trim().length <= 40;
  });
  if (!heading) {
    return result("appendix", "PASS", []);
  }
  return result("appendix", "FAIL", [
    {
      page: heading.page,
      detail: `Appendices are not allowed in the paper (found heading: '${heading.text.trim().slice(0, 60)}' on page ${heading.page}); submit them separately`,
      rect: lineRect(heading),
    },
  ]);
}

/* ----------------------------- 4. anonymization -------------------------- */

export function checkAnonymized(data: PaperData): CheckResult {
  const H = data.pageHeight;
  const top = data.lines.filter((l) => l.page === 1 && l.y < H * 0.35);
  const hits = top.filter(
    (l) => /\banonymous\b/i.test(l.text) || /^paper\s*id\b/i.test(l.text.trim()),
  );
  if (hits.length === 0) {
    return result("anonymized", "PASS", []);
  }
  return result("anonymized", "FAIL", [
    {
      page: 1,
      detail: `Paper must be de-anonymized for camera-ready (found: '${hits.map((h) => h.text.trim().slice(0, 60)).join(" / ")}')`,
      rect: unionRects(hits),
    },
  ]);
}

/* ----------------------------- 5. undefined refs ------------------------- */

export function checkUndefinedRefs(data: PaperData): CheckResult {
  const qmarks = data.lines.filter((l) => l.text.includes("??"));
  const missingCites = data.lines.filter((l) => /\[\?\]/.test(l.text));
  const all = [...qmarks, ...missingCites];
  if (all.length === 0) {
    return result("undefined_refs", "PASS", []);
  }
  return result("undefined_refs", "FAIL", [
    {
      page: all[0]!.page,
      detail: `Undefined references found (?? or [?]) on page(s) ${[...new Set(all.map((l) => l.page))].join(", ")}`,
      rect: lineRect(all[0]!),
    },
  ]);
}

/* ------------------------------- 6. page limit --------------------------- */

const REFS_HEADING_RE = /^references$/i;

function inMargin(l: PageLine): boolean {
  return l.y < 40 || l.y > l.pageHeight - 54;
}

/**
 * The main content must fit within the page limit; references are
 * excluded. Content = everything up to the References heading: page R
 * counts as content only if body text appears above the heading there,
 * otherwise content ended on page R-1. Everything after the heading
 * (the bibliography, however far it spills) is not counted.
 */
export function checkPageLimit(data: PaperData, config: Config): CheckResult {
  const heading = data.lines.find((l) => REFS_HEADING_RE.test(l.text.trim()));
  let contentEnd: number;
  let detail: string;
  if (!heading) {
    contentEnd = data.pageCount;
    detail =
      "No 'References' section found; counting every page as content. " +
      `Content ends on page ${contentEnd}.`;
  } else {
    const R = heading.page;
    const bodyAboveHeading = data.lines.some(
      (l) => l.page === R && l.y < heading.y - 2 && !inMargin(l),
    );
    contentEnd = bodyAboveHeading ? R : R - 1;
    detail =
      `References start on page ${R}; content ends on page ${contentEnd} ` +
      `(limit ${config.pageLimit}, references excluded).`;
  }
  const status = contentEnd > config.pageLimit ? "FAIL" : "PASS";
  return result("page_limit", status, [{ detail: `${detail} Total pages: ${data.pageCount}.` }]);
}

/* ------------------------------ 7. page numbers -------------------------- */

const PAGENUM_RE = /^(?:page\s*)?(?:\d{1,4}|[ivxlcm]{1,8})(?:\s*(?:of|\/)\s*\d{1,4})?$/i;

export function checkPageNumbers(data: PaperData): CheckResult {
  const margin = 54; // 0.75 inch
  const hits: PageLine[] = [];
  const pages = [...new Set(data.lines.map((l) => l.page))];
  for (const p of pages) {
    const pageLines = data.lines.filter((l) => l.page === p);
    // Odd-size pages (e.g. embedded figure sheets) are skipped: the
    // chair's rule targets numbered document pages.
    if (
      Math.abs(pageLines[0]!.pageWidth - data.pageWidth) > 2 ||
      Math.abs(pageLines[0]!.pageHeight - data.pageHeight) > 2
    ) {
      continue;
    }
    const bottom = pageLines.filter((l) => l.y > l.pageHeight - margin);
    const top = pageLines.filter((l) => l.y + l.h < margin);
    // A real page-number footer holds 1-2 digit lines in a margin strip.
    // Many short numeric lines means figure/axis labels, not page numbers.
    for (const strip of [bottom, top]) {
      const digits = strip.filter((l) => PAGENUM_RE.test(l.text.trim()));
      if (digits.length > 0 && digits.length <= 2) hits.push(...digits);
    }
  }
  if (hits.length === 0) {
    return result("page_numbers", "PASS", []);
  }
  const badPages = [...new Set(hits.map((l) => l.page))];
  return result("page_numbers", "FAIL", [
    {
      page: badPages[0],
      detail: `Pages must not be numbered (found page numbers on page(s) ${badPages.join(", ")}: '${hits[0]!.text.trim()}')`,
      rect: lineRect(hits[0]!),
    },
  ]);
}

/* --------------------------------- 8/9. fonts ---------------------------- */

export function checkFontsEmbedded(data: PaperData): CheckResult {
  const bad = data.fonts.filter((f) => !f.embedded);
  if (bad.length === 0) {
    return result("fonts_embedded", "PASS", []);
  }
  const names = [...new Set(bad.map((f) => f.name.replace(/^\//, "")))];
  return result("fonts_embedded", "FAIL", [
    {
      detail: `All fonts must be embedded. Not embedded: ${names.join(", ")} (e.g. page ${bad[0]!.page})`,
    },
  ]);
}

export function checkFontsType3(data: PaperData): CheckResult {
  const bad = data.fonts.filter((f) => f.type3);
  if (bad.length === 0) {
    return result("fonts_type3", "PASS", []);
  }
  const names = [...new Set(bad.map((f) => f.name.replace(/^\//, "")))];
  return result("fonts_type3", "FAIL", [
    {
      page: bad[0]!.page,
      detail: `Type 3 fonts are forbidden. Found: ${names.join(", ")}`,
    },
  ]);
}
