// SPDX-License-Identifier: MIT
import type { CheckId, PaperReport } from "./types.ts";

export const CHECK_LABELS: Record<CheckId, string> = {
  copyright: "IEEE copyright on p.1",
  title: "Title capitalization",
  artifact_appendix: "No AD/AE appendix",
  appendix: "No appendix in paper",
  anonymized: "De-anonymized",
  undefined_refs: "No undefined refs",
  page_limit: "Page limit",
  page_numbers: "No page numbers",
  style: "Style conformance",
  fonts_embedded: "Fonts embedded",
  fonts_type3: "No Type 3 fonts",
};

export const CHECK_ORDER: CheckId[] = Object.keys(CHECK_LABELS) as CheckId[];

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function renderCsv(reports: PaperReport[]): string {
  const head = ["file", "valid", "pages", ...CHECK_ORDER.map((i) => CHECK_LABELS[i])];
  const rows = reports.map((r) => {
    const byId = new Map(r.results.map((c) => [c.id as CheckId, c.status]));
    return [
      r.file,
      r.valid ? "valid" : "invalid",
      String(r.pageCount),
      ...CHECK_ORDER.map((i) => byId.get(i) ?? ""),
    ];
  });
  return [head, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}
