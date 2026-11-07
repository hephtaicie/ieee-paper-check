// SPDX-License-Identifier: MIT
export type CheckId =
  | "copyright"
  | "appendix"
  | "title"
  | "artifact_appendix"
  | "anonymized"
  | "undefined_refs"
  | "page_limit"
  | "page_numbers"
  | "font_size"
  | "style"
  | "fonts_embedded"
  | "fonts_type3";

export type CheckStatus = "PASS" | "FAIL";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Evidence {
  page?: number;
  detail: string;
  /** Location of the evidence on the page (top-origin coordinates). */
  rect?: Rect;
}

export interface CheckResult {
  id: CheckId;
  status: CheckStatus;
  evidence: Evidence[];
}

export interface FontInfo {
  page: number;
  name: string;
  type3: boolean;
  embedded: boolean;
}

export interface PageLine {
  page: number; // 1-based
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  font: string;
  size: number;
  /** Fill colour of the first styled run in the line ("#rrggbb"), if
   * the extractor could attribute one. Absent ≈ black. */
  color?: string;
  pageWidth: number;
  pageHeight: number;
}

export interface PaperData {
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
  lines: PageLine[];
  fonts: FontInfo[];
}

export interface PreviewRegion {
  id: "title" | "copyright" | "abstract" | "first_figure_caption" | "references";
  label: string;
  page: number;
  rect: Rect;
}

export interface PaperReport {
  file: string;
  /** Title extracted from page 1 (best effort, may be empty). */
  title: string;
  /** Best-effort page crops used by the web preview carousel. */
  previews: PreviewRegion[];
  /** Whether an Artifact Description/Evaluation section was found, even if
   * allowed for this round. */
  artifactAppendixPresent: boolean;
  pageCount: number;
  results: CheckResult[];
  valid: boolean;
}

export interface Config {
  minPageLimit: number;
  pageLimit: number;
  /** Legacy single accepted copyright variant; prefer acceptedCopyrights. */
  requiredCopyright: string | null;
  /** Any normalized variant may satisfy the copyright check. Empty means
   * accept any otherwise-valid IEEE copyright notice (unless legacy
   * requiredCopyright is set). */
  acceptedCopyrights: string[];
  allowArtifactAppendix: boolean;
  smallWords: string[];
  acronyms: string[];
  /** Words/components exempt from title-case checks (case-insensitive). */
  titleAllowedWords: string[];
  /** Appendices are forbidden in the paper body (submitted separately). */
  forbidAppendices: boolean;
  /** Expected extracted PDF text size for title and first main-body sentence. */
  fontSizeTitle: number;
  fontSizeBody: number;
  /** Checks not to run at all: no report row, never affects validity.
   * Overridable per conference/round through a --config JSON file. */
  disabledChecks: CheckId[];
}

export const DEFAULT_CONFIG: Config = {
  minPageLimit: 4,
  pageLimit: 12,
  requiredCopyright: null,
  acceptedCopyrights: [],
  allowArtifactAppendix: false,
  forbidAppendices: true,
  fontSizeTitle: 24,
  fontSizeBody: 10,
  // Font sizing and full style review remain independently opt-in.
  disabledChecks: ["style", "font_size"],
  smallWords: [
    "a",
    "an",
    "and",
    "as",
    "at",
    "but",
    "by",
    "for",
    "from",
    "in",
    "into",
    "nor",
    "of",
    "on",
    "onto",
    "or",
    "per",
    "the",
    "to",
    "up",
    "via",
    "with",
    "without",
  ],
  // All-caps words of <= 5 letters are accepted automatically, so this
  // list only needs acronyms a conference wants to allow above that.
  acronyms: [],
  titleAllowedWords: [],
};
